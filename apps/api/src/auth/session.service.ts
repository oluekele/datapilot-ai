import { Inject, Injectable } from "@nestjs/common";
import type { Session, User } from "@prisma/client";
import type { Request, Response } from "express";
import { AuthContext } from "../common/auth-context";
import { randomToken, sha256 } from "../common/crypto";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { PrismaService } from "../database/prisma.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Opaque server-side sessions. The cookie holds a random token; the database
 * holds only its hash, so sessions can be revoked instantly (logout, password
 * reset, suspension) — something stateless JWTs cannot do.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(user: User, req: Request, res: Response): Promise<Session> {
    const token = randomToken();
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        activeOrganizationId: membership?.organizationId ?? null,
        expiresAt: new Date(Date.now() + this.config.session.idleDays * DAY_MS),
        ipAddress: req.ip?.slice(0, 45),
        userAgent: req.headers["user-agent"]?.slice(0, 500),
      },
    });
    res.cookie(this.config.session.cookieName, token, {
      httpOnly: true,
      secure: this.config.production,
      sameSite: "lax",
      path: "/",
      maxAge: this.config.session.idleDays * DAY_MS,
    });
    return session;
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.config.session.cookieName, { path: "/" });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  hasRecentStepUp(session: Session): boolean {
    return (
      !!session.stepUpAt &&
      Date.now() - session.stepUpAt.getTime() <
        this.config.session.stepUpMinutes * 60_000
    );
  }

  stepUpUntil(session: Session): Date | null {
    if (!this.hasRecentStepUp(session) || !session.stepUpAt) return null;
    return new Date(session.stepUpAt.getTime() + this.config.session.stepUpMinutes * 60_000);
  }

  /** Resolve the request's session, user and active organisation membership. */
  async resolve(req: Request): Promise<AuthContext | null> {
    const token = req.cookies?.[this.config.session.cookieName];
    if (typeof token !== "string" || token.length < 20 || token.length > 100) {
      return null;
    }
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.createdAt.getTime() + this.config.session.absoluteDays * DAY_MS <= now ||
      session.user.status !== "ACTIVE"
    ) {
      return null;
    }

    let membership = session.activeOrganizationId
      ? await this.prisma.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: session.activeOrganizationId,
              userId: session.userId,
            },
          },
          include: { organization: true },
        })
      : null;
    if (!membership) {
      membership = await this.prisma.organizationMembership.findFirst({
        where: { userId: session.userId },
        orderBy: { createdAt: "asc" },
        include: { organization: true },
      });
    }

    // Sliding expiry, written at most once a minute to limit write load.
    const update: { lastUsedAt?: Date; expiresAt?: Date; activeOrganizationId?: string | null } = {};
    if (now - session.lastUsedAt.getTime() > 60_000) {
      update.lastUsedAt = new Date(now);
      update.expiresAt = new Date(now + this.config.session.idleDays * DAY_MS);
    }
    if ((membership?.organizationId ?? null) !== session.activeOrganizationId) {
      update.activeOrganizationId = membership?.organizationId ?? null;
    }
    if (Object.keys(update).length) {
      await this.prisma.session.update({ where: { id: session.id }, data: update });
    }

    const { user, ...sessionRow } = session;
    return {
      user,
      session: { ...sessionRow, ...update } as Session,
      organization: membership?.organization ?? null,
      role: membership?.role ?? null,
    };
  }
}

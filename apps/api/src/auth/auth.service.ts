import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, Session } from "@prisma/client";
import * as argon2 from "argon2";
import type { Request, Response } from "express";
import { AuditService } from "../common/audit.service";
import { AuthContext } from "../common/auth-context";
import { randomToken, sha256 } from "../common/crypto";
import { AppError } from "../common/errors";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { PrismaService } from "../database/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { MailService } from "../mail/mail.service";
import { makeSlug } from "../organizations/slug";
import { LoginDto, RegisterDto } from "./auth.dto";
import { SessionService } from "./session.service";

const HOUR_MS = 60 * 60 * 1000;
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class AuthService {
  // Verified against when the email is unknown, so response timing does not
  // reveal which addresses have accounts.
  private readonly dummyHash = argon2.hash(randomToken(), ARGON_OPTIONS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates the account and its workspace, starts the free trial and signs the
   * user in. There is no email verification step.
   */
  async register(dto: RegisterDto, req: Request, res: Response) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new AppError(409, "CONFLICT", "An account with this email already exists. Sign in instead.");
    }

    const passwordHash = await argon2.hash(dto.password, ARGON_OPTIONS);
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: dto.email, passwordHash, displayName: dto.displayName, status: "ACTIVE" },
      });
      const orgName =
        dto.accountType === "TEAM" ? dto.organizationName! : `${dto.displayName}'s workspace`;
      const org = await tx.organization.create({
        data: {
          name: orgName,
          slug: makeSlug(orgName),
          kind: dto.accountType,
          createdById: user.id,
          memberships: { create: { userId: user.id, role: "OWNER" } },
        },
      });
      await this.audit.record(
        {
          action: "user.registered",
          actorUserId: user.id,
          organizationId: org.id,
          subjectType: "user",
          subjectId: user.id,
          metadata: { accountType: dto.accountType },
          req,
        },
        tx,
      );
      await this.startSignupTrial(tx, user.id, req);
      return user;
    });
    const session = await this.sessions.create(user, req, res);
    await this.audit.record({ action: "auth.login", actorUserId: user.id, req });
    return this.me(user.id, session);
  }

  /**
   * Every new account starts with a free trial. One-time per user and per
   * organisation: an owner who already had a trial gets none.
   */
  private async startSignupTrial(tx: Prisma.TransactionClient, userId: string, req: Request): Promise<number> {
    const days = this.config.autoTrialDays;
    if (days <= 0) return 0;
    const owned = await tx.organizationMembership.findFirst({
      where: { userId, role: "OWNER", organization: { createdById: userId } },
      orderBy: { createdAt: "asc" },
    });
    if (!owned) return 0;
    const result = await this.entitlements.startTrial(tx, owned.organizationId, {
      days,
      reason: "Automatic free trial on sign-up",
      grantedById: null,
    });
    if (!result.started) return 0;
    await this.audit.record(
      {
        action: "trial.started",
        actorUserId: userId,
        organizationId: owned.organizationId,
        subjectType: "organization",
        subjectId: owned.organizationId,
        metadata: { days, expiresAt: result.expiresAt.toISOString(), automatic: true },
        req,
      },
      tx,
    );
    return days;
  }

  async login(dto: LoginDto, req: Request, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) {
      throw new AppError(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again in a few minutes.");
    }
    const valid = user
      ? await argon2.verify(user.passwordHash, dto.password)
      : (await argon2.verify(await this.dummyHash, dto.password), false);

    if (!user || !valid) {
      if (user) {
        const failures = user.failedLoginCount + 1;
        const lock = failures >= this.config.lockout.maxFailures;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: lock ? 0 : failures,
            lockedUntil: lock ? new Date(now.getTime() + this.config.lockout.minutes * 60_000) : undefined,
          },
        });
        await this.audit.record({ action: lock ? "auth.locked" : "auth.login_failed", actorUserId: user.id, req });
      }
      throw new AppError(401, "UNAUTHENTICATED", "Incorrect email or password.");
    }
    if (user.status === "PENDING_EMAIL") {
      // Signed up while email verification existed: activate and start the
      // trial they would have received on verification.
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });
        await this.startSignupTrial(tx, user.id, req);
      });
    }
    if (user.status === "SUSPENDED") {
      throw new AppError(403, "ACCOUNT_SUSPENDED", "This account is suspended. Contact DataPilot support.");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    if (argon2.needsRehash(user.passwordHash, ARGON_OPTIONS)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await argon2.hash(dto.password, ARGON_OPTIONS) },
      });
    }
    const session = await this.sessions.create(user, req, res);
    await this.audit.record({ action: "auth.login", actorUserId: user.id, req });
    return this.me(user.id, session);
  }

  async logout(auth: AuthContext | undefined, req: Request, res: Response) {
    if (auth) {
      await this.sessions.revoke(auth.session.id);
      await this.audit.record({ action: "auth.logout", actorUserId: auth.user.id, req });
    }
    this.sessions.clearCookie(res);
    return { ok: true };
  }

  async forgotPassword(email: string, req: Request) {
    const message = "If an account exists for that email, we've sent a reset link.";
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === "SUSPENDED") return { message };
    const recent = await this.prisma.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - HOUR_MS) } },
    });
    if (recent >= 5) return { message };
    const token = randomToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + HOUR_MS) },
    });
    const url = this.mail.link(`/reset-password?token=${token}`);
    await this.mail.send(
      user.email,
      "Reset your DataPilot password",
      `Use this link within one hour to choose a new password:\n${url}\n\nIf you didn't ask for this, ignore this email.`,
    );
    await this.audit.record({ action: "auth.password_reset_requested", actorUserId: user.id, req });
    return this.config.mail.exposeDevLinks ? { message, devResetUrl: url } : { message };
  }

  async resetPassword(token: string, password: string, req: Request) {
    const now = new Date();
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.consumedAt || record.expiresAt <= now) {
      throw new AppError(400, "INVALID_TOKEN", "This reset link is invalid or has expired.");
    }
    const passwordHash = await argon2.hash(password, ARGON_OPTIONS);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) throw new AppError(400, "INVALID_TOKEN", "This reset link has already been used.");
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
      await this.audit.record({ action: "auth.password_reset", actorUserId: record.userId, req }, tx);
    });
    return { message: "Your password has been changed. Sign in with your new password." };
  }

  async stepUp(auth: AuthContext, password: string, req: Request) {
    if (!(await argon2.verify(auth.user.passwordHash, password))) {
      await this.audit.record({ action: "auth.step_up_failed", actorUserId: auth.user.id, req });
      throw new AppError(401, "UNAUTHENTICATED", "Incorrect password.");
    }
    const session = await this.prisma.session.update({
      where: { id: auth.session.id },
      data: { stepUpAt: new Date() },
    });
    await this.audit.record({ action: "auth.step_up", actorUserId: auth.user.id, req });
    return { stepUpUntil: this.sessions.stepUpUntil(session) };
  }

  async completeOnboarding(auth: AuthContext) {
    await this.prisma.user.update({
      where: { id: auth.user.id },
      data: { onboardingCompletedAt: auth.user.onboardingCompletedAt ?? new Date() },
    });
    return { ok: true };
  }

  async switchOrganization(auth: AuthContext, organizationId: string) {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: auth.user.id } },
    });
    if (!membership) throw new AppError(404, "NOT_FOUND", "Organisation not found.");
    const session = await this.prisma.session.update({
      where: { id: auth.session.id },
      data: { activeOrganizationId: organizationId },
    });
    return this.me(auth.user.id, session);
  }

  async me(userId: string, session: Session) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: { include: { organization: true }, orderBy: { createdAt: "asc" } },
      },
    });
    const organizations = user.memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      kind: m.organization.kind,
      role: m.role,
      status: m.organization.status,
    }));
    const active =
      organizations.find((o) => o.id === session.activeOrganizationId) ?? organizations[0] ?? null;
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        platformRole: user.platformRole,
        onboardingCompleted: !!user.onboardingCompletedAt,
      },
      organizations,
      activeOrganization: active,
      entitlement: active ? await this.entitlements.forOrganization(active.id) : null,
      stepUpUntil: this.sessions.stepUpUntil(session),
    };
  }
}

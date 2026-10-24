import { Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../common/audit.service";
import { AuthContext, TenantContext } from "../common/auth-context";
import { randomToken, sha256 } from "../common/crypto";
import { AppError, notFound } from "../common/errors";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { PrismaService } from "../database/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { MailService } from "../mail/mail.service";
import { InviteDto } from "./organizations.dto";

const INVITE_DAYS = 7;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly entitlements: EntitlementsService,
    private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(ctx: TenantContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.organization.id },
      include: {
        memberships: { include: { user: true }, orderBy: { createdAt: "asc" } },
        invitations: {
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    return {
      id: org.id,
      name: org.name,
      kind: org.kind,
      status: org.status,
      members: org.memberships.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        displayName: m.user.displayName,
        role: m.role,
        joinedAt: m.createdAt,
      })),
      // Admins manage invitations; plain members only see who belongs.
      invitations:
        ctx.role === "MEMBER"
          ? []
          : org.invitations.map((i) => ({
              id: i.id,
              email: i.email,
              role: i.role,
              expiresAt: i.expiresAt,
              createdAt: i.createdAt,
            })),
    };
  }

  async rename(ctx: TenantContext, name: string, req: Request) {
    await this.prisma.organization.update({ where: { id: ctx.organization.id }, data: { name } });
    await this.audit.record({
      action: "organization.renamed",
      actorUserId: ctx.user.id,
      organizationId: ctx.organization.id,
      metadata: { name },
      req,
    });
    return { ok: true };
  }

  async invite(ctx: TenantContext, dto: InviteDto, req: Request) {
    if (ctx.organization.kind !== "TEAM") {
      throw new AppError(400, "BAD_REQUEST", "Individual workspaces cannot invite members. Create an organisation account instead.");
    }
    const token = randomToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      await this.entitlements.assertCanAddMember(tx, ctx.organization.id);
      const alreadyMember = await tx.organizationMembership.findFirst({
        where: { organizationId: ctx.organization.id, user: { email: dto.email } },
      });
      if (alreadyMember) throw new AppError(409, "CONFLICT", "That person is already a member.");
      // Supersede any pending invitation for the same address.
      await tx.invitation.updateMany({
        where: { organizationId: ctx.organization.id, email: dto.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const invitation = await tx.invitation.create({
        data: {
          organizationId: ctx.organization.id,
          email: dto.email,
          role: dto.role,
          tokenHash: sha256(token),
          invitedById: ctx.user.id,
          expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
        },
      });
      await this.audit.record(
        {
          action: "organization.member_invited",
          actorUserId: ctx.user.id,
          organizationId: ctx.organization.id,
          subjectType: "invitation",
          subjectId: invitation.id,
          metadata: { email: dto.email, role: dto.role },
          req,
        },
        tx,
      );
      return invitation;
    });
    const url = this.mail.link(`/invite?token=${token}`);
    await this.mail.send(
      dto.email,
      `You're invited to ${ctx.organization.name} on DataPilot`,
      `${ctx.user.displayName} invited you to join ${ctx.organization.name} on DataPilot.\n\nAccept within ${INVITE_DAYS} days:\n${url}\n`,
    );
    return this.config.mail.exposeDevLinks
      ? { id: invitation.id, devInviteUrl: url }
      : { id: invitation.id };
  }

  async revokeInvitation(ctx: TenantContext, id: string, req: Request) {
    const result = await this.prisma.invitation.updateMany({
      where: { id, organizationId: ctx.organization.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw notFound("Invitation");
    await this.audit.record({
      action: "organization.invitation_revoked",
      actorUserId: ctx.user.id,
      organizationId: ctx.organization.id,
      subjectType: "invitation",
      subjectId: id,
      req,
    });
    return { ok: true };
  }

  async acceptInvitation(auth: AuthContext, token: string, req: Request) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { organization: true },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw new AppError(400, "INVALID_TOKEN", "This invitation is invalid or has expired.");
    }
    if (invitation.email !== auth.user.email) {
      throw new AppError(403, "FORBIDDEN", "This invitation was sent to a different email address.");
    }
    if (invitation.organization.status === "SUSPENDED") {
      throw new AppError(403, "ORG_SUSPENDED", "This organisation is suspended.");
    }
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppError(400, "INVALID_TOKEN", "This invitation has already been used.");
      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: auth.user.id } },
        create: { organizationId: invitation.organizationId, userId: auth.user.id, role: invitation.role },
        update: {},
      });
      await tx.session.update({
        where: { id: auth.session.id },
        data: { activeOrganizationId: invitation.organizationId },
      });
      await this.audit.record(
        {
          action: "organization.member_joined",
          actorUserId: auth.user.id,
          organizationId: invitation.organizationId,
          subjectType: "user",
          subjectId: auth.user.id,
          req,
        },
        tx,
      );
    });
    return this.authService.me(auth.user.id, {
      ...auth.session,
      activeOrganizationId: invitation.organizationId,
    });
  }

  private async findMember(ctx: TenantContext, userId: string) {
    const member = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: ctx.organization.id, userId } },
    });
    if (!member) throw notFound("Member");
    if (member.role === "OWNER") {
      throw new AppError(403, "FORBIDDEN", "The organisation owner cannot be changed or removed.");
    }
    return member;
  }

  async updateMember(ctx: TenantContext, userId: string, role: "ADMIN" | "MEMBER", req: Request) {
    const member = await this.findMember(ctx, userId);
    await this.prisma.organizationMembership.update({ where: { id: member.id }, data: { role } });
    await this.audit.record({
      action: "organization.member_role_changed",
      actorUserId: ctx.user.id,
      organizationId: ctx.organization.id,
      subjectType: "user",
      subjectId: userId,
      metadata: { from: member.role, to: role },
      req,
    });
    return { ok: true };
  }

  async removeMember(ctx: TenantContext, userId: string, req: Request) {
    const member = await this.findMember(ctx, userId);
    if (ctx.role === "ADMIN" && member.role === "ADMIN" && userId !== ctx.user.id) {
      throw new AppError(403, "FORBIDDEN_ROLE", "Only the owner can remove administrators.");
    }
    await this.prisma.organizationMembership.delete({ where: { id: member.id } });
    await this.audit.record({
      action: "organization.member_removed",
      actorUserId: ctx.user.id,
      organizationId: ctx.organization.id,
      subjectType: "user",
      subjectId: userId,
      req,
    });
    return { ok: true };
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { AuditService } from "../common/audit.service";
import { AuthContext } from "../common/auth-context";
import { AppError, notFound } from "../common/errors";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { PrismaService } from "../database/prisma.service";
import { creatorSelect, serializeJob } from "../datasets/serializers";
import { EntitlementsService, parseLimits } from "../entitlements/entitlements.service";
import { addInterval } from "../billing/billing.service";
import { ActivateSubscriptionDto, UpdatePlanDto } from "./admin.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

const orgInclude = {
  subscription: { include: { plan: true } },
  trialUse: true,
  memberships: { where: { role: "OWNER" as const }, include: { user: { include: { trialUse: true } } } },
  _count: { select: { memberships: true, datasets: { where: { deletedAt: null } } } },
} satisfies Prisma.OrganizationInclude;

type AdminOrgRow = Prisma.OrganizationGetPayload<{ include: typeof orgInclude }>;

const auditInclude = {
  actor: { select: { email: true } },
  organization: { select: { name: true } },
} satisfies Prisma.AuditEventInclude;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  trialIneligibility(org: AdminOrgRow): string | null {
    return this.entitlements.trialIneligibility(org);
  }

  private async toAdminOrg(org: AdminOrgRow) {
    const owner = org.memberships[0]?.user ?? null;
    const reason = this.trialIneligibility(org);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      kind: org.kind,
      status: org.status,
      suspendedReason: org.suspendedReason,
      createdAt: org.createdAt,
      owner: owner ? { id: owner.id, email: owner.email, displayName: owner.displayName } : null,
      memberCount: org._count.memberships,
      datasetCount: org._count.datasets,
      entitlement: { ...this.entitlements.evaluate(org), usage: await this.entitlements.usage(org.id) },
      trial: org.trialUse
        ? { startedAt: org.trialUse.startedAt, expiresAt: org.trialUse.expiresAt, endedEarlyAt: org.trialUse.endedEarlyAt, reason: org.trialUse.reason }
        : null,
      trialEligible: reason === null,
      trialIneligibleReason: reason,
    };
  }

  private async loadOrg(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id }, include: orgInclude });
    if (!org) throw notFound("Organisation");
    return org;
  }

  async overview() {
    const since24h = new Date(Date.now() - DAY_MS);
    const since30d = new Date(Date.now() - 30 * DAY_MS);
    const now = new Date();
    const [users, orgs, subs, trialsActive, trialsConsumed, jobs, failed24h, succeeded24h, revenue, recentAudit] = await Promise.all([
      this.prisma.user.groupBy({ by: ["status"], _count: true }),
      this.prisma.organization.groupBy({ by: ["status"], _count: true }),
      this.prisma.subscription.groupBy({ by: ["status"], _count: true }),
      this.prisma.organizationTrialUse.count({ where: { endedEarlyAt: null, expiresAt: { gt: now } } }),
      this.prisma.organizationTrialUse.count(),
      this.prisma.processingJob.groupBy({ by: ["status"], where: { status: { in: ["QUEUED", "RUNNING"] } }, _count: true }),
      this.prisma.processingJob.count({ where: { status: "FAILED", finishedAt: { gte: since24h } } }),
      this.prisma.processingJob.count({ where: { status: "SUCCEEDED", finishedAt: { gte: since24h } } }),
      this.prisma.payment.groupBy({ by: ["currency"], where: { status: "SUCCEEDED", paidAt: { gte: since30d } }, _sum: { amountMinor: true } }),
      this.prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: auditInclude }),
    ]);
    const count = <T extends { _count: number }>(rows: (T & Record<string, unknown>)[], key: string, value: string) =>
      rows.find((r) => r[key] === value)?._count ?? 0;
    return {
      users: {
        total: users.reduce((n, r) => n + r._count, 0),
        active: count(users, "status", "ACTIVE"),
        pendingEmail: count(users, "status", "PENDING_EMAIL"),
        suspended: count(users, "status", "SUSPENDED"),
      },
      organizations: { total: orgs.reduce((n, r) => n + r._count, 0), suspended: count(orgs, "status", "SUSPENDED") },
      subscriptions: {
        active: count(subs, "status", "ACTIVE"),
        pastDue: count(subs, "status", "PAST_DUE"),
        canceled: count(subs, "status", "CANCELED"),
      },
      trials: { active: trialsActive, consumed: trialsConsumed },
      jobs: { queued: count(jobs, "status", "QUEUED"), running: count(jobs, "status", "RUNNING"), failed24h, succeeded24h },
      revenue: { last30Days: Object.fromEntries(revenue.map((r) => [r.currency, r._sum.amountMinor ?? 0])) },
      recentAudit,
    };
  }

  async organizations(q?: string, status?: string) {
    const where: Prisma.OrganizationWhereInput = {};
    if (status === "ACTIVE" || status === "SUSPENDED") where.status = status;
    if (q?.trim()) {
      const term = q.trim().slice(0, 100);
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { slug: { contains: term, mode: "insensitive" } },
        { memberships: { some: { user: { email: { contains: term, mode: "insensitive" } } } } },
      ];
    }
    const orgs = await this.prisma.organization.findMany({ where, include: orgInclude, orderBy: { createdAt: "desc" }, take: 200 });
    return Promise.all(orgs.map((o) => this.toAdminOrg(o)));
  }

  async organization(id: string) {
    const org = await this.loadOrg(id);
    const [members, recentJobs, payments, audit] = await Promise.all([
      this.prisma.organizationMembership.findMany({ where: { organizationId: id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
      this.prisma.processingJob.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { createdBy: creatorSelect, dataset: { select: { name: true } } },
      }),
      this.prisma.payment.findMany({ where: { organizationId: id }, orderBy: { createdAt: "desc" }, take: 50, include: { plan: true } }),
      this.prisma.auditEvent.findMany({ where: { organizationId: id }, orderBy: { createdAt: "desc" }, take: 50, include: auditInclude }),
    ]);
    return {
      ...(await this.toAdminOrg(org)),
      members: members.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        displayName: m.user.displayName,
        role: m.role,
        status: m.user.status,
        joinedAt: m.createdAt,
      })),
      recentJobs: recentJobs.map((j) => serializeJob(j)),
      payments: payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: p.status,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        planName: p.plan?.name ?? null,
      })),
      audit,
    };
  }

  private record(admin: AuthContext, action: string, organizationId: string | null, metadata: Prisma.InputJsonObject, req: Request, tx?: Prisma.TransactionClient) {
    return this.audit.record(
      { action: `admin.${action}`, actorUserId: admin.user.id, organizationId, subjectType: organizationId ? "organization" : undefined, subjectId: organizationId ?? undefined, metadata, req },
      tx,
    );
  }

  async setOrganizationStatus(admin: AuthContext, id: string, status: "ACTIVE" | "SUSPENDED", reason: string, req: Request) {
    await this.loadOrg(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: { status, suspendedReason: status === "SUSPENDED" ? reason : null },
      });
      await this.record(admin, status === "SUSPENDED" ? "organization_suspended" : "organization_reactivated", id, { reason }, req, tx);
    });
    return this.organization(id);
  }

  /** Grant the one-time free trial (see EntitlementsService.startTrial). */
  async grantTrial(admin: AuthContext, id: string, days: number, reason: string, req: Request) {
    await this.loadOrg(id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const result = await this.entitlements.startTrial(tx, id, { days, reason, grantedById: admin.user.id });
        if (!result.started) throw new AppError(409, "TRIAL_ALREADY_USED", result.reason);
        await this.record(admin, "trial_granted", id, { days, reason, ownerUserId: result.ownerUserId }, req, tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(409, "TRIAL_ALREADY_USED", "A free trial has already been used by this organisation or its owner.");
      }
      throw error;
    }
    return this.organization(id);
  }

  /** Ends a trial early. The trial remains consumed and cannot be granted again. */
  async endTrial(admin: AuthContext, id: string, reason: string, req: Request) {
    await this.prisma.$transaction(async (tx) => {
      const ended = await tx.organizationTrialUse.updateMany({
        where: { organizationId: id, endedEarlyAt: null, expiresAt: { gt: new Date() } },
        data: { endedEarlyAt: new Date() },
      });
      if (!ended.count) throw new AppError(400, "BAD_REQUEST", "This organisation has no active trial.");
      await this.record(admin, "trial_ended", id, { reason }, req, tx);
    });
    return this.organization(id);
  }

  async activateSubscription(admin: AuthContext, id: string, dto: ActivateSubscriptionDto, req: Request) {
    await this.loadOrg(id);
    const plan = await this.prisma.plan.findUnique({ where: { code: dto.planCode } });
    if (!plan) throw notFound("Plan");
    const now = new Date();
    const end = addInterval(now, "monthly", dto.months);
    await this.prisma.$transaction(async (tx) => {
      const data = {
        planId: plan.id,
        status: "ACTIVE" as const,
        source: "ADMIN" as const,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: true,
      };
      await tx.subscription.upsert({ where: { organizationId: id }, create: { organizationId: id, ...data }, update: data });
      await this.record(admin, "subscription_activated", id, { planCode: plan.code, months: dto.months, until: end.toISOString(), reason: dto.reason }, req, tx);
    });
    return this.organization(id);
  }

  async cancelSubscription(admin: AuthContext, id: string, reason: string, req: Request) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { organizationId: id, status: { not: "CANCELED" } },
        data: { status: "CANCELED", currentPeriodEnd: new Date() },
      });
      if (!updated.count) throw new AppError(400, "BAD_REQUEST", "There is no subscription to cancel.");
      await this.record(admin, "subscription_canceled", id, { reason }, req, tx);
    });
    return this.organization(id);
  }

  async users(q?: string) {
    const term = q?.trim().slice(0, 100);
    const users = await this.prisma.user.findMany({
      where: term
        ? { OR: [{ email: { contains: term, mode: "insensitive" } }, { displayName: { contains: term, mode: "insensitive" } }] }
        : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { memberships: { include: { organization: { select: { id: true, name: true } } } }, trialUse: true },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
      platformRole: u.platformRole,
      emailVerifiedAt: u.emailVerifiedAt,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      organizations: u.memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role })),
      trialUsed: !!u.trialUse,
    }));
  }

  async setUserStatus(admin: AuthContext, id: string, suspend: boolean, reason: string, req: Request) {
    if (id === admin.user.id) throw new AppError(400, "BAD_REQUEST", "You cannot change your own account status.");
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound("User");
    if (user.platformRole === "SUPER_ADMIN" && suspend) {
      throw new AppError(403, "FORBIDDEN", "Demote a platform administrator before suspending them.");
    }
    const status = suspend ? "SUSPENDED" : "ACTIVE";
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status } });
      await this.audit.record(
        { action: suspend ? "admin.user_suspended" : "admin.user_reactivated", actorUserId: admin.user.id, subjectType: "user", subjectId: id, metadata: { reason }, req },
        tx,
      );
    });
    if (suspend) await this.sessions.revokeAllForUser(id);
    return { ok: true, status };
  }

  async jobs(status?: string) {
    const valid = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"];
    const jobs = await this.prisma.processingJob.findMany({
      where: status && valid.includes(status) ? { status: status as never } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { createdBy: creatorSelect, dataset: { select: { name: true } }, organization: { select: { name: true } } },
    });
    return jobs.map((j) => serializeJob(j));
  }

  auditLog(action?: string, organizationId?: string) {
    return this.prisma.auditEvent.findMany({
      where: {
        ...(action ? { action: { contains: action.slice(0, 100) } } : {}),
        ...(organizationId && /^[0-9a-f-]{36}$/i.test(organizationId) ? { organizationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: auditInclude,
    });
  }

  async plans() {
    const plans = await this.prisma.plan.findMany({ orderBy: { priceMinor: "asc" } });
    return plans.map((p) => ({ ...p, limits: parseLimits(p.limits, this.config.trialLimits) }));
  }

  async updatePlan(admin: AuthContext, code: string, dto: UpdatePlanDto, req: Request) {
    const plan = await this.prisma.plan.findUnique({ where: { code } });
    if (!plan) throw notFound("Plan");
    const limits = dto.limits ? parseLimits(dto.limits, parseLimits(plan.limits, this.config.trialLimits)) : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.plan.update({
        where: { code },
        data: {
          priceMinor: dto.priceMinor,
          providerPlanCode: dto.providerPlanCode === "" ? null : dto.providerPlanCode,
          active: dto.active,
          limits,
        },
      });
      await this.audit.record(
        {
          action: "admin.plan_updated",
          actorUserId: admin.user.id,
          subjectType: "plan",
          subjectId: code,
          metadata: { reason: dto.reason, priceMinor: dto.priceMinor ?? null, active: dto.active ?? null, limits: limits ?? null },
          req,
        },
        tx,
      );
      return updated;
    });
    return { ...updated, limits: parseLimits(updated.limits, this.config.trialLimits) };
  }
}

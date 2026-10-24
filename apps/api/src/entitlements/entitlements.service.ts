import { Inject, Injectable } from "@nestjs/common";
import type {
  Organization,
  OrganizationTrialUse,
  Plan,
  Prisma,
  Subscription,
} from "@prisma/client";
import { AppError } from "../common/errors";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { PrismaService } from "../database/prisma.service";

export type Limits = {
  maxDatasets: number;
  maxJobsPerMonth: number;
  maxFileMb: number;
  maxMembers: number;
};

export type Entitlement = {
  active: boolean;
  reason: "SUBSCRIPTION" | "TRIAL" | "GRACE" | "NONE" | "SUSPENDED";
  plan: { code: string; name: string } | null;
  trial: { startedAt: Date; expiresAt: Date; active: boolean } | null;
  subscription: {
    status: Subscription["status"];
    planCode: string;
    planName: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    source: Subscription["source"];
  } | null;
  graceUntil: Date | null;
  limits: Limits;
  usage: { datasets: number; jobsThisMonth: number; members: number };
};

type OrgWithAccess = Organization & {
  subscription: (Subscription & { plan: Plan }) | null;
  trialUse: OrganizationTrialUse | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseLimits(value: Prisma.JsonValue, fallback: Limits): Limits {
  const v = (value ?? {}) as Partial<Limits>;
  const pick = (key: keyof Limits) =>
    typeof v[key] === "number" && v[key]! >= 0 ? v[key]! : fallback[key];
  return {
    maxDatasets: pick("maxDatasets"),
    maxJobsPerMonth: pick("maxJobsPerMonth"),
    maxFileMb: pick("maxFileMb"),
    maxMembers: pick("maxMembers"),
  };
}

export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The single source of truth for "may this organisation use paid features".
 * Every paid operation calls `assert*` here on the server; the UI only mirrors it.
 *
 * Default is subscription-only. A free trial exists only if a super-admin
 * granted one (see AdminService.grantTrial), and is one-time per organisation
 * and per owner.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private loadOrg(organizationId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { subscription: { include: { plan: true } }, trialUse: true },
    });
  }

  /** Pure evaluation of access state (no usage); exported for testing. */
  evaluate(org: OrgWithAccess, now = new Date()): Omit<Entitlement, "usage"> {
    const sub = org.subscription;
    const trial = org.trialUse;
    const trialActive =
      !!trial && !trial.endedEarlyAt && trial.expiresAt.getTime() > now.getTime();
    const base = {
      trial: trial
        ? { startedAt: trial.startedAt, expiresAt: trial.endedEarlyAt ?? trial.expiresAt, active: trialActive }
        : null,
      subscription: sub
        ? {
            status: sub.status,
            planCode: sub.plan.code,
            planName: sub.plan.name,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            source: sub.source,
          }
        : null,
    };
    const planLimits = sub ? parseLimits(sub.plan.limits, this.config.trialLimits) : this.config.trialLimits;

    if (org.status === "SUSPENDED") {
      return { ...base, active: false, reason: "SUSPENDED", plan: null, graceUntil: null, limits: planLimits };
    }

    if (sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE") && sub.currentPeriodEnd) {
      const end = sub.currentPeriodEnd.getTime();
      const plan = { code: sub.plan.code, name: sub.plan.name };
      if (sub.status === "ACTIVE" && end > now.getTime()) {
        return { ...base, active: true, reason: "SUBSCRIPTION", plan, graceUntil: null, limits: planLimits };
      }
      // Renewal failed or is late: keep working for a short grace period.
      const graceEnd = end + this.config.billing.graceDays * DAY_MS;
      if (graceEnd > now.getTime()) {
        return { ...base, active: true, reason: "GRACE", plan, graceUntil: new Date(graceEnd), limits: planLimits };
      }
    }

    if (trialActive) {
      return {
        ...base,
        active: true,
        reason: "TRIAL",
        plan: { code: "trial", name: "Free trial" },
        graceUntil: null,
        limits: this.config.trialLimits,
      };
    }

    return { ...base, active: false, reason: "NONE", plan: null, graceUntil: null, limits: planLimits };
  }

  async usage(organizationId: string, tx: Prisma.TransactionClient = this.prisma) {
    const [datasets, jobsThisMonth, members] = await Promise.all([
      tx.dataset.count({ where: { organizationId, deletedAt: null } }),
      tx.processingJob.count({
        where: { organizationId, billable: true, createdAt: { gte: startOfUtcMonth() } },
      }),
      tx.organizationMembership.count({ where: { organizationId } }),
    ]);
    return { datasets, jobsThisMonth, members };
  }

  async forOrganization(
    organizationId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Entitlement> {
    const org = await this.loadOrg(organizationId, tx);
    return { ...this.evaluate(org), usage: await this.usage(organizationId, tx) };
  }

  /**
   * Serialise usage checks per organisation inside a transaction, so two
   * concurrent requests cannot both pass a limit check.
   */
  async lock(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
  }

  /** Why an organisation cannot start a free trial, or null if it can. */
  trialIneligibility(org: {
    status: Organization["status"];
    trialUse: OrganizationTrialUse | null;
    memberships: { user: { trialUse: unknown | null } }[];
  }): string | null {
    if (org.trialUse) return "This organisation has already used its free trial.";
    const owner = org.memberships[0]?.user;
    if (!owner) return "The organisation has no owner.";
    if (owner.trialUse) return "The owner has already used a free trial with another organisation.";
    if (org.status === "SUSPENDED") return "Reactivate the organisation first.";
    return null;
  }

  /**
   * Start the one-time free trial for an organisation and its owner. Enforced
   * three ways: the eligibility check, a per-organisation advisory lock, and
   * unique constraints on OrganizationTrialUse.organizationId and
   * UserTrialUse.userId. Rows are never deleted, so a trial cannot be reused.
   *
   * Returns the reason when the organisation is not eligible (nothing is created).
   */
  async startTrial(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: { days: number; reason: string; grantedById: string | null },
  ): Promise<{ started: true; ownerUserId: string; expiresAt: Date } | { started: false; reason: string }> {
    await this.lock(tx, organizationId);
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        trialUse: true,
        memberships: { where: { role: "OWNER" }, include: { user: { include: { trialUse: true } } } },
      },
    });
    const ineligible = this.trialIneligibility(org);
    if (ineligible) return { started: false, reason: ineligible };
    const owner = org.memberships[0].user;
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + input.days * DAY_MS);
    await tx.organizationTrialUse.create({
      data: { organizationId, startedAt, expiresAt, reason: input.reason, grantedById: input.grantedById },
    });
    await tx.userTrialUse.create({
      data: { userId: owner.id, organizationId, startedAt, expiresAt, grantedById: input.grantedById },
    });
    return { started: true, ownerUserId: owner.id, expiresAt };
  }

  private requireActive(e: Entitlement): void {
    if (e.reason === "SUSPENDED") {
      throw new AppError(403, "ORG_SUSPENDED", "This organisation is suspended.");
    }
    if (!e.active) {
      throw new AppError(
        402,
        "SUBSCRIPTION_REQUIRED",
        "An active subscription is required to upload or process data.",
      );
    }
  }

  async assertCanUpload(
    tx: Prisma.TransactionClient,
    organizationId: string,
    fileBytes: number,
  ): Promise<Entitlement> {
    await this.lock(tx, organizationId);
    const e = await this.forOrganization(organizationId, tx);
    this.requireActive(e);
    if (e.usage.datasets >= e.limits.maxDatasets) {
      throw new AppError(402, "PLAN_LIMIT", `Your plan allows ${e.limits.maxDatasets} datasets. Delete one or upgrade.`);
    }
    if (fileBytes > e.limits.maxFileMb * 1024 * 1024) {
      throw new AppError(402, "PLAN_LIMIT", `Your plan allows files up to ${e.limits.maxFileMb} MB.`);
    }
    return e;
  }

  async assertCanRunJob(tx: Prisma.TransactionClient, organizationId: string): Promise<Entitlement> {
    await this.lock(tx, organizationId);
    const e = await this.forOrganization(organizationId, tx);
    this.requireActive(e);
    if (e.usage.jobsThisMonth >= e.limits.maxJobsPerMonth) {
      throw new AppError(
        402,
        "PLAN_LIMIT",
        `You have used all ${e.limits.maxJobsPerMonth} processing runs this month.`,
      );
    }
    return e;
  }

  async assertCanAddMember(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    await this.lock(tx, organizationId);
    const e = await this.forOrganization(organizationId, tx);
    this.requireActive(e);
    const pending = await tx.invitation.count({
      where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (e.usage.members + pending >= e.limits.maxMembers) {
      throw new AppError(402, "PLAN_LIMIT", `Your plan allows ${e.limits.maxMembers} members.`);
    }
  }
}

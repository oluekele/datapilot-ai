import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, type Plan } from "@prisma/client";
import type { Request } from "express";
import { AuditService } from "../common/audit.service";
import { TenantContext } from "../common/auth-context";
import { randomToken, sha256 } from "../common/crypto";
import { AppError, notFound } from "../common/errors";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { PrismaService } from "../database/prisma.service";
import { EntitlementsService, parseLimits } from "../entitlements/entitlements.service";
import { PaystackClient, PaystackTransaction } from "./paystack.client";

export function addInterval(from: Date, interval: string, count = 1): Date {
  const months = interval === "annually" ? 12 * count : interval === "quarterly" ? 3 * count : count;
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

type WebhookEvent = { event?: string; data?: Record<string, unknown> };

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly paystack: PaystackClient | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.paystack = config.billing.paystackSecretKey ? new PaystackClient(config.billing.paystackSecretKey) : null;
  }

  serializePlan(plan: Plan) {
    return {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      interval: plan.interval,
      limits: parseLimits(plan.limits, this.config.trialLimits),
    };
  }

  trialPolicy() {
    return {
      days: this.config.autoTrialDays,
      automatic: this.config.autoTrialDays > 0,
      limits: this.config.trialLimits,
    };
  }

  async plans() {
    const plans = await this.prisma.plan.findMany({ where: { active: true }, orderBy: { priceMinor: "asc" } });
    return plans.map((p) => this.serializePlan(p));
  }

  async overview(ctx: TenantContext) {
    const payments = await this.prisma.payment.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { plan: true },
    });
    return {
      entitlement: await this.entitlements.forOrganization(ctx.organization.id),
      paymentsEnabled: !!this.paystack,
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
    };
  }

  private requirePaystack(): PaystackClient {
    if (!this.paystack) {
      throw new AppError(503, "PAYMENTS_DISABLED", "Online payment is not configured. Contact DataPilot support to subscribe.");
    }
    return this.paystack;
  }

  async checkout(ctx: TenantContext, planCode: string, req: Request) {
    const paystack = this.requirePaystack();
    const plan = await this.prisma.plan.findFirst({ where: { code: planCode, active: true } });
    if (!plan) throw notFound("Plan");
    const reference = `dp_${randomToken(18)}`;
    await this.prisma.payment.create({
      data: {
        organizationId: ctx.organization.id,
        planId: plan.id,
        provider: "paystack",
        reference,
        amountMinor: plan.priceMinor,
        currency: plan.currency,
      },
    });
    const init = await paystack.initialize({
      email: ctx.user.email,
      amount: plan.priceMinor,
      reference,
      plan: plan.providerPlanCode,
      callbackUrl: new URL(`/app/billing?reference=${reference}`, this.config.publicWebUrl).toString(),
      metadata: { organizationId: ctx.organization.id, planCode: plan.code },
    });
    await this.audit.record({
      action: "billing.checkout_started",
      actorUserId: ctx.user.id,
      organizationId: ctx.organization.id,
      metadata: { planCode, reference },
      req,
    });
    return { authorizationUrl: init.authorization_url, reference };
  }

  /** Called when the customer returns from Paystack; the webhook does the same idempotently. */
  async verify(ctx: TenantContext, reference: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { reference, organizationId: ctx.organization.id },
    });
    if (!payment) throw notFound("Payment");
    if (payment.status === "PENDING") {
      const tx = await this.requirePaystack().verify(reference);
      await this.applyTransaction(tx);
    }
    const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { status: updated.status };
  }

  async cancel(ctx: TenantContext, req: Request) {
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId: ctx.organization.id } });
    if (!sub || sub.status === "CANCELED") throw new AppError(400, "BAD_REQUEST", "There is no active subscription to cancel.");
    if (sub.providerSubscriptionId && sub.providerEmailToken) {
      await this.requirePaystack().disableSubscription(sub.providerSubscriptionId, sub.providerEmailToken);
    }
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    await this.audit.record({
      action: "billing.cancel_requested",
      actorUserId: ctx.user.id,
      organizationId: ctx.organization.id,
      req,
    });
    return { ok: true };
  }

  /**
   * Apply a verified successful charge. Idempotent: a payment that is already
   * SUCCEEDED never extends the subscription twice.
   */
  async applyTransaction(tx: PaystackTransaction): Promise<void> {
    if (tx.status !== "success") {
      if (tx.status === "failed" || tx.status === "abandoned") {
        await this.prisma.payment.updateMany({ where: { reference: tx.reference, status: "PENDING" }, data: { status: "FAILED" } });
      }
      return;
    }
    const customerCode = tx.customer?.customer_code ?? null;
    const planCode = typeof tx.plan === "string" ? tx.plan : tx.plan?.plan_code;

    await this.prisma.$transaction(async (db) => {
      let payment = await db.payment.findUnique({ where: { reference: tx.reference }, include: { plan: true } });
      if (!payment) {
        // A renewal charge Paystack initiated: match it to an existing subscription.
        const sub = customerCode
          ? await db.subscription.findFirst({
              where: { provider: "paystack", providerCustomerId: customerCode, ...(planCode ? { plan: { providerPlanCode: planCode } } : {}) },
            })
          : null;
        if (!sub) {
          this.logger.warn(`Unmatched Paystack charge ${tx.reference}`);
          return;
        }
        payment = await db.payment.create({
          data: { organizationId: sub.organizationId, planId: sub.planId, provider: "paystack", reference: tx.reference, amountMinor: tx.amount, currency: tx.currency },
          include: { plan: true },
        });
      }
      const claimed = await db.payment.updateMany({
        where: { id: payment.id, status: { not: "SUCCEEDED" } },
        data: { status: "SUCCEEDED", paidAt: tx.paid_at ? new Date(tx.paid_at) : new Date(), amountMinor: tx.amount, currency: tx.currency },
      });
      if (claimed.count === 0 || !payment.plan) return;
      if (tx.amount < payment.plan.priceMinor || tx.currency !== payment.plan.currency) {
        this.logger.error(`Paystack amount mismatch for ${tx.reference}`);
        return;
      }

      const existing = await db.subscription.findUnique({ where: { organizationId: payment.organizationId } });
      const now = new Date();
      const from =
        existing?.status === "ACTIVE" && existing.planId === payment.planId && existing.currentPeriodEnd && existing.currentPeriodEnd > now
          ? existing.currentPeriodEnd
          : now;
      const data = {
        planId: payment.plan.id,
        status: "ACTIVE" as const,
        source: "PAYMENT" as const,
        provider: "paystack",
        providerCustomerId: customerCode ?? existing?.providerCustomerId ?? null,
        currentPeriodStart: from === now ? now : existing?.currentPeriodStart ?? now,
        currentPeriodEnd: addInterval(from, payment.plan.interval),
        cancelAtPeriodEnd: false,
      };
      await db.subscription.upsert({
        where: { organizationId: payment.organizationId },
        create: { organizationId: payment.organizationId, ...data },
        update: data,
      });
      await this.audit.record(
        {
          action: "billing.payment_succeeded",
          organizationId: payment.organizationId,
          subjectType: "payment",
          subjectId: payment.id,
          metadata: { reference: tx.reference, amountMinor: tx.amount, currency: tx.currency, plan: payment.plan.code },
        },
        db,
      );
    });
  }

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
    const paystack = this.paystack;
    if (!paystack || !rawBody || !paystack.verifySignature(rawBody, signature)) {
      throw new AppError(401, "UNAUTHENTICATED", "Invalid signature.");
    }
    const payload = JSON.parse(rawBody.toString("utf8")) as WebhookEvent;
    const type = String(payload.event ?? "unknown").slice(0, 80);
    const data = payload.data ?? {};
    const eventId = `${type}:${String(data.id ?? data.reference ?? data.subscription_code ?? sha256(rawBody))}`.slice(0, 200);

    try {
      await this.prisma.billingWebhookEvent.create({
        data: {
          provider: "paystack",
          providerEventId: eventId,
          eventType: type,
          summary: {
            reference: (data.reference as string) ?? null,
            subscriptionCode: (data.subscription_code as string) ?? null,
            status: (data.status as string) ?? null,
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return; // duplicate delivery
      throw error;
    }

    try {
      await this.processEvent(type, data);
      await this.prisma.billingWebhookEvent.update({
        where: { provider_providerEventId: { provider: "paystack", providerEventId: eventId } },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(`Webhook ${type} failed: ${(error as Error).message}`);
      // Delete the marker so Paystack's retry is processed again.
      await this.prisma.billingWebhookEvent.delete({
        where: { provider_providerEventId: { provider: "paystack", providerEventId: eventId } },
      });
      throw error;
    }
  }

  private async processEvent(type: string, data: Record<string, unknown>): Promise<void> {
    const customer = data.customer as { customer_code?: string } | undefined;
    const subscriptionCode = data.subscription_code as string | undefined;
    switch (type) {
      case "charge.success": {
        // Never trust the webhook body for money: re-fetch from Paystack.
        const reference = data.reference as string;
        if (reference && this.paystack) await this.applyTransaction(await this.paystack.verify(reference));
        return;
      }
      case "subscription.create": {
        if (!customer?.customer_code || !subscriptionCode) return;
        await this.prisma.subscription.updateMany({
          where: { provider: "paystack", providerCustomerId: customer.customer_code },
          data: { providerSubscriptionId: subscriptionCode, providerEmailToken: (data.email_token as string) ?? null },
        });
        return;
      }
      case "subscription.not_renew":
        if (subscriptionCode) {
          await this.prisma.subscription.updateMany({ where: { providerSubscriptionId: subscriptionCode }, data: { cancelAtPeriodEnd: true } });
        }
        return;
      case "subscription.disable":
        if (subscriptionCode) {
          await this.prisma.subscription.updateMany({ where: { providerSubscriptionId: subscriptionCode }, data: { status: "CANCELED" } });
        }
        return;
      case "invoice.payment_failed": {
        const sub = data.subscription as { subscription_code?: string } | undefined;
        const code = sub?.subscription_code ?? subscriptionCode;
        if (code) {
          await this.prisma.subscription.updateMany({ where: { providerSubscriptionId: code, status: "ACTIVE" }, data: { status: "PAST_DUE" } });
        }
        return;
      }
      default:
        return;
    }
  }
}

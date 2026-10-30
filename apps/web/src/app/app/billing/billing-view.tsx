"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMe } from "@/components/me-provider";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { EntitlementBadge, StatusBadge } from "@/components/status-badges";
import { Button, EmptyState, ErrorNotice, Modal, Notice, StatCard } from "@/components/ui";
import { PaymentsTable } from "@/components/payments-table";
import { useResource } from "@/components/use-resource";
import { apiPost } from "@/lib/api";
import { daysUntil, formatDate, formatInterval, formatMoney, formatNumber } from "@/lib/format";
import type { BillingInfo, Plan } from "@/lib/types";

export function BillingView({ reference }: { reference: string | null }) {
  const router = useRouter();
  const { me, refresh } = useMe();
  const billing = useResource<BillingInfo>("/billing");
  const plans = useResource<Plan[]>("/billing/plans");
  const [verifying, setVerifying] = useState<{ state: "pending" | "done" | "failed"; status?: string; error?: unknown } | null>(reference ? { state: "pending" } : null);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const verifyStarted = useRef(false);
  const reloadBilling = billing.reload;

  useEffect(() => {
    if (!reference || verifyStarted.current) return;
    verifyStarted.current = true;
    apiPost<{ status: string }>("/billing/verify", { reference })
      .then(async (result) => {
        setVerifying({ state: "done", status: result.status });
        await Promise.all([reloadBilling(), refresh()]);
      })
      .catch((err: unknown) => setVerifying({ state: "failed", error: err }))
      .finally(() => router.replace("/app/billing"));
  }, [reference, reloadBilling, refresh, router]);

  if (!me) return null;
  const role = me.activeOrganization?.role;
  const canManage = role === "OWNER" || role === "ADMIN";
  const ent = billing.data?.entitlement ?? me.entitlement;
  const sub = ent?.subscription ?? null;
  const paymentsEnabled = billing.data?.paymentsEnabled ?? false;

  async function checkout(planCode: string): Promise<void> {
    setCheckoutPlan(planCode);
    setError(null);
    try {
      const result = await apiPost<{ authorizationUrl: string; reference: string }>("/billing/checkout", { planCode });
      const url = new URL(result.authorizationUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unexpected payment URL.");
      window.location.assign(url.toString());
    } catch (err) {
      setError(err);
      setCheckoutPlan(null);
    }
  }

  async function cancelRenewal(): Promise<void> {
    setCanceling(true);
    setError(null);
    try {
      await apiPost("/billing/cancel");
      await Promise.all([billing.reload(), refresh()]);
      setConfirmCancel(false);
    } catch (err) {
      setError(err);
    } finally {
      setCanceling(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="WORKSPACE / BILLING" title="Plan &" emphasis="billing.">
        Uploading and processing require an active subscription. Viewing and downloading your data never does.
      </PageHeader>

      {verifying?.state === "pending" && <Notice tone="info" title="Confirming your payment…">This only takes a moment.</Notice>}
      {verifying?.state === "done" && (
        <Notice tone={verifying.status?.toUpperCase() === "SUCCESS" || verifying.status?.toUpperCase() === "ACTIVE" ? "good" : "warn"} title="Payment checked">
          Status: {verifying.status?.toLowerCase().replace(/_/g, " ") ?? "unknown"}. If your subscription doesn&apos;t look right, it may take a minute to update.
        </Notice>
      )}
      {verifying?.state === "failed" && <ErrorNotice error={verifying.error} title="We couldn't confirm that payment" />}
      <ErrorNotice error={error} />
      <ErrorNotice error={billing.error} title="Couldn't load billing" />

      {billing.loading && !billing.data && <LoadingBlock label="Loading billing…" />}

      {ent && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">CURRENT ACCESS</div>
              <h2>{ent.plan?.name ?? (ent.reason === "TRIAL" ? "Free trial" : "No active plan")}</h2>
            </div>
            <EntitlementBadge entitlement={ent} />
          </div>
          <dl className="overview-grid">
            <div><dt>Status</dt><dd>{sub ? <StatusBadge status={sub.status} /> : ent.active ? "Active" : "Inactive"}</dd></div>
            {sub && <div><dt>{sub.cancelAtPeriodEnd ? "Access ends" : "Renews"}</dt><dd>{formatDate(sub.currentPeriodEnd)}</dd></div>}
            {sub && <div><dt>Source</dt><dd>{sub.source === "ADMIN" ? "Arranged with DataPilot" : "Card payment"}</dd></div>}
            {ent.trial && (
              <div><dt>Trial</dt><dd>{ent.trial.active ? `${daysUntil(ent.trial.expiresAt)} days left` : `Ended ${formatDate(ent.trial.expiresAt)}`}</dd></div>
            )}
            {ent.graceUntil && <div><dt>Grace until</dt><dd>{formatDate(ent.graceUntil)}</dd></div>}
          </dl>
          <div className="stat-grid">
            <StatCard label="DATASETS" value={<>{formatNumber(ent.usage.datasets)}<small> / {formatNumber(ent.limits.maxDatasets)}</small></>} meter={{ used: ent.usage.datasets, limit: ent.limits.maxDatasets }} />
            <StatCard label="JOBS THIS MONTH" value={<>{formatNumber(ent.usage.jobsThisMonth)}<small> / {formatNumber(ent.limits.maxJobsPerMonth)}</small></>} meter={{ used: ent.usage.jobsThisMonth, limit: ent.limits.maxJobsPerMonth }} />
            <StatCard label="MEMBERS" value={<>{formatNumber(ent.usage.members)}<small> / {formatNumber(ent.limits.maxMembers)}</small></>} meter={{ used: ent.usage.members, limit: ent.limits.maxMembers }} />
            <StatCard label="MAX FILE SIZE" value={<>{formatNumber(ent.limits.maxFileMb)}<small> MB</small></>} />
          </div>
          {sub?.cancelAtPeriodEnd && <Notice tone="info">Renewal is cancelled. You keep access until {formatDate(sub.currentPeriodEnd)}.</Notice>}
          {canManage && sub?.status === "ACTIVE" && !sub.cancelAtPeriodEnd && sub.source === "PAYMENT" && (
            <div className="button-row"><Button variant="ghost" size="small" onClick={() => setConfirmCancel(true)}>Cancel renewal</Button></div>
          )}
        </section>
      )}

      <section className="section-block">
        <div className="section-head"><h2>Plans</h2></div>
        {!paymentsEnabled && billing.data && (
          <Notice tone="info" title="Online payment is not configured">Contact DataPilot support to arrange a subscription by bank transfer or invoice.</Notice>
        )}
        {!canManage && <p className="muted small">Only owners and admins can change the subscription.</p>}
        <p className="muted small">Every new account gets one free trial at sign-up — one per person and per business, so it can&apos;t be restarted.</p>
        <ErrorNotice error={plans.error} title="Couldn't load plans" />
        {plans.data && (
          <div className="plan-grid">
            {plans.data.map((plan) => {
              const current = ent?.plan?.code === plan.code && ent.reason !== "TRIAL";
              return (
                <article key={plan.code} className={`plan-card ${current ? "plan-featured" : ""}`}>
                  <div className="eyebrow">{current ? "CURRENT PLAN" : plan.code.toUpperCase()}</div>
                  <h3>{plan.name}</h3>
                  <div className="plan-price"><b>{formatMoney(plan.priceMinor, plan.currency)}</b><span>/ {formatInterval(plan.interval)}</span></div>
                  {plan.description && <p>{plan.description}</p>}
                  <ul className="plan-limits">
                    <li>{formatNumber(plan.limits.maxDatasets)} datasets</li>
                    <li>{formatNumber(plan.limits.maxJobsPerMonth)} jobs / month</li>
                    <li>Files up to {formatNumber(plan.limits.maxFileMb)} MB</li>
                    <li>{formatNumber(plan.limits.maxMembers)} {plan.limits.maxMembers === 1 ? "member" : "members"}</li>
                  </ul>
                  <Button
                    size="small"
                    variant={current ? "light" : "dark"}
                    loading={checkoutPlan === plan.code}
                    disabled={!canManage || !paymentsEnabled || checkoutPlan !== null || (current && sub?.status === "ACTIVE")}
                    onClick={() => void checkout(plan.code)}
                  >
                    {current && sub?.status === "ACTIVE" ? "Current plan" : current ? "Renew" : "Subscribe"}
                  </Button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-head"><h2>Payment history</h2></div>
        {billing.data && billing.data.payments.length === 0 && <EmptyState icon="◇" title="No payments yet" />}
        {billing.data && billing.data.payments.length > 0 && <PaymentsTable payments={billing.data.payments} />}
      </section>

      <Modal
        open={confirmCancel}
        title="Cancel renewal?"
        onClose={() => setConfirmCancel(false)}
        locked={canceling}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep subscription</Button>
            <Button variant="danger" loading={canceling} onClick={() => void cancelRenewal()}>Cancel renewal</Button>
          </>
        }
      >
        <p>Your subscription won&apos;t renew. You keep full access until {formatDate(sub?.currentPeriodEnd)}; after that, your data remains viewable and downloadable.</p>
      </Modal>
    </>
  );
}

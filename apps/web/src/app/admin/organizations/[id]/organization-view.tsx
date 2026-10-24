"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useAdminAction } from "@/components/admin/admin-actions";
import { AuditTable } from "@/components/admin/audit-table";
import { JobsTable } from "@/components/jobs-table";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { PaymentsTable } from "@/components/payments-table";
import { EntitlementBadge, StatusBadge } from "@/components/status-badges";
import { Badge, Button, ErrorNotice, Notice, StatCard } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import { apiPost } from "@/lib/api";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { AdminOrgDetail, AdminPlan } from "@/lib/types";

export function AdminOrganizationView({ orgId }: { orgId: string }) {
  const base = `/admin/organizations/${encodeURIComponent(orgId)}`;
  const org = useResource<AdminOrgDetail>(base);
  const plans = useResource<AdminPlan[]>("/admin/plans");
  const run = useAdminAction();
  const [trialDays, setTrialDays] = useState(14);
  const [planCode, setPlanCode] = useState("");
  const [months, setMonths] = useState(1);

  const data = org.data;
  if (org.loading && !data) return <LoadingBlock />;
  if (!data) return <><ErrorNotice error={org.error} /><Link className="button button-light button-small" href="/admin/organizations">← Organisations</Link></>;

  const ent = data.entitlement;
  const sub = ent?.subscription ?? null;
  const trialActive = !!ent?.trial?.active;
  const activePlans = (plans.data ?? []).filter((p) => p.active);
  const selectedPlan = planCode || activePlans[0]?.code || "";
  const daysValid = Number.isInteger(trialDays) && trialDays >= 1 && trialDays <= 90;
  const monthsValid = Number.isInteger(months) && months >= 1 && months <= 24;

  const act = (title: string, path: string, extra: Record<string, unknown> = {}, opts: { danger?: boolean; description?: ReactNode; confirmLabel?: string } = {}) =>
    void run({
      title,
      description: opts.description,
      danger: opts.danger,
      confirmLabel: opts.confirmLabel ?? title,
      perform: (reason) => apiPost(`${base}${path}`, { ...extra, reason }),
      onDone: () => org.reload(),
    });

  return (
    <>
      <PageHeader eyebrow="ADMIN / ORGANISATION" title={data.name} actions={<Link className="text-button" href="/admin/organizations">← All organisations</Link>}>
        {data.kind === "TEAM" ? "Team" : "Individual"} · {data.slug} · created {formatDate(data.createdAt)}
      </PageHeader>

      {data.status === "SUSPENDED" && <Notice tone="bad" title="Suspended">{data.suspendedReason ?? "No reason recorded."}</Notice>}

      <div className="stat-grid">
        <StatCard label="STATUS" value={<StatusBadge status={data.status} />} sub={<>Access: <EntitlementBadge entitlement={ent} /></>} />
        <StatCard label="OWNER" value={<span className="stat-text">{data.owner?.displayName ?? "—"}</span>} sub={data.owner?.email} />
        <StatCard label="DATASETS" value={<>{formatNumber(ent?.usage.datasets ?? data.datasetCount)}<small> / {formatNumber(ent?.limits.maxDatasets)}</small></>} />
        <StatCard label="JOBS THIS MONTH" value={<>{formatNumber(ent?.usage.jobsThisMonth)}<small> / {formatNumber(ent?.limits.maxJobsPerMonth)}</small></>} />
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><div><div className="eyebrow">ENTITLEMENT</div><h2>{ent?.plan?.name ?? "No plan"}</h2></div></div>
          <dl className="overview-grid">
            <div><dt>Subscription</dt><dd>{sub ? <><StatusBadge status={sub.status} /> {sub.planName}</> : "None"}</dd></div>
            {sub && <div><dt>Period end</dt><dd>{formatDate(sub.currentPeriodEnd)}{sub.cancelAtPeriodEnd ? " (cancelling)" : ""}</dd></div>}
            {sub && <div><dt>Source</dt><dd>{sub.source.toLowerCase()}</dd></div>}
            <div><dt>Trial</dt><dd>{data.trial ? `${formatDate(data.trial.startedAt)} → ${formatDate(data.trial.endedEarlyAt ?? data.trial.expiresAt)}${data.trial.endedEarlyAt ? " (ended early)" : ""}` : "Never granted"}</dd></div>
            {ent?.graceUntil && <div><dt>Grace until</dt><dd>{formatDate(ent.graceUntil)}</dd></div>}
          </dl>
          {data.trial?.reason && <p className="muted small">Trial reason: {data.trial.reason}</p>}
        </section>

        <section className="panel">
          <div className="panel-head"><div><div className="eyebrow">ACCOUNT</div><h2>Status</h2></div></div>
          {data.status === "ACTIVE" ? (
            <Button variant="danger" size="small" onClick={() => act("Suspend organisation", "/suspend", {}, { danger: true, description: <p>All members lose the ability to upload and process. Data stays intact.</p> })}>Suspend organisation</Button>
          ) : (
            <Button size="small" onClick={() => act("Reactivate organisation", "/reactivate")}>Reactivate organisation</Button>
          )}
        </section>
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><div><div className="eyebrow">FREE TRIAL</div><h2>One per business</h2></div></div>
          <p className="muted small">Trials are granted on request, once per organisation <b>and</b> once per owner — a new organisation by the same owner is not eligible.</p>
          {trialActive ? (
            <>
              <Notice tone="info">Trial active until {formatDateTime(ent.trial?.expiresAt)}.</Notice>
              <Button variant="light" size="small" onClick={() => act("End trial early", "/trial/end", {}, { danger: true, description: <p>The trial stays consumed and cannot be granted again.</p> })}>End trial early</Button>
            </>
          ) : (
            <div className="inline-form">
              <label className="field inline-field">
                <span>Days (1–90)</span>
                <input type="number" min={1} max={90} value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} disabled={!data.trialEligible} />
              </label>
              <Button
                size="small"
                disabled={!data.trialEligible || !daysValid}
                onClick={() => act(`Grant ${trialDays}-day free trial`, "/trial", { days: trialDays }, { confirmLabel: "Grant trial" })}
              >
                Grant free trial
              </Button>
            </div>
          )}
          {!data.trialEligible && !trialActive && (
            <Notice tone="warn" title="Not eligible">{data.trialIneligibleReason ?? "This organisation or its owner has already had a trial."}</Notice>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><div><div className="eyebrow">SUBSCRIPTION</div><h2>Manual activation</h2></div></div>
          <p className="muted small">For bank transfers or invoices. Activates the selected plan for the chosen number of months.</p>
          <ErrorNotice error={plans.error} />
          <div className="inline-form">
            <label className="field inline-field">
              <span>Plan</span>
              <select value={selectedPlan} onChange={(e) => setPlanCode(e.target.value)}>
                {activePlans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <label className="field inline-field">
              <span>Months (1–24)</span>
              <input type="number" min={1} max={24} value={months} onChange={(e) => setMonths(Number(e.target.value))} />
            </label>
            <Button size="small" disabled={!selectedPlan || !monthsValid}
              onClick={() => act(`Activate ${months} month${months === 1 ? "" : "s"} of ${activePlans.find((p) => p.code === selectedPlan)?.name ?? selectedPlan}`, "/subscription", { planCode: selectedPlan, months }, { confirmLabel: "Activate" })}>
              Activate
            </Button>
          </div>
          {sub && sub.status !== "CANCELED" && (
            <Button variant="ghost" size="small" onClick={() => act("Cancel subscription", "/subscription/cancel", {}, { danger: true })}>Cancel subscription</Button>
          )}
        </section>
      </div>

      <section className="section-block">
        <div className="section-head"><h2>Members</h2><span className="muted">{data.members.length}</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Joined</th></tr></thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.userId ?? m.id ?? m.email}>
                  <td>{m.displayName}</td>
                  <td>{m.email}</td>
                  <td><Badge tone={m.role === "OWNER" ? "deep" : "neutral"}>{m.role.toLowerCase()}</Badge></td>
                  <td className="nowrap">{formatDate(m.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-block">
        <div className="section-head"><h2>Recent jobs</h2></div>
        {data.recentJobs.length === 0 ? <p className="muted small">No jobs.</p> : <JobsTable jobs={data.recentJobs} linkDatasets={false} />}
      </section>

      <section className="section-block">
        <div className="section-head"><h2>Payments</h2></div>
        {data.payments.length === 0 ? <p className="muted small">No payments.</p> : <PaymentsTable payments={data.payments} />}
      </section>

      <section className="section-block">
        <div className="section-head"><h2>Audit trail</h2></div>
        <AuditTable events={data.audit} showOrg={false} />
      </section>
    </>
  );
}

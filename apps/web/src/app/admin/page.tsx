"use client";

import Link from "next/link";
import { AuditTable } from "@/components/admin/audit-table";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { ErrorNotice, StatCard } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import { formatMoney, formatNumber } from "@/lib/format";
import type { AdminOverview } from "@/lib/types";

export default function AdminOverviewPage() {
  const overview = useResource<AdminOverview>("/admin/overview");
  const data = overview.data;
  const revenue = data ? Object.entries(data.revenue.last30Days ?? {}) : [];

  return (
    <>
      <PageHeader eyebrow="ADMIN / OVERVIEW" title="Platform" emphasis="at a glance." actions={<button type="button" className="button button-light button-small" onClick={() => void overview.reload()}>Refresh</button>} />
      {overview.loading && !data && <LoadingBlock />}
      <ErrorNotice error={overview.error} title="Couldn't load overview" />
      {data && (
        <>
          <div className="stat-grid">
            <StatCard label="USERS" value={formatNumber(data.users.total)} sub={`${formatNumber(data.users.active)} active · ${formatNumber(data.users.suspended)} suspended`} />
            <StatCard label="ORGANISATIONS" value={formatNumber(data.organizations.total)} sub={`${formatNumber(data.organizations.suspended)} suspended`} />
            <StatCard label="SUBSCRIPTIONS" value={formatNumber(data.subscriptions.active)} sub={`${formatNumber(data.subscriptions.pastDue)} past due · ${formatNumber(data.subscriptions.canceled)} canceled`} />
            <StatCard label="TRIALS" value={formatNumber(data.trials.active)} sub={`${formatNumber(data.trials.consumed)} consumed all-time`} />
          </div>

          <div className="two-col">
            <section className="panel">
              <div className="panel-head"><div><div className="eyebrow">JOBS HEALTH</div><h2>Processing</h2></div><Link className="text-button" href="/admin/jobs">View failed →</Link></div>
              <dl className="overview-grid">
                <div><dt>Queued</dt><dd>{formatNumber(data.jobs.queued)}</dd></div>
                <div><dt>Running</dt><dd>{formatNumber(data.jobs.running)}</dd></div>
                <div><dt>Succeeded 24h</dt><dd>{formatNumber(data.jobs.succeeded24h)}</dd></div>
                <div><dt>Failed 24h</dt><dd className={data.jobs.failed24h > 0 ? "text-bad" : ""}>{formatNumber(data.jobs.failed24h)}</dd></div>
              </dl>
            </section>
            <section className="panel">
              <div className="panel-head"><div><div className="eyebrow">REVENUE · LAST 30 DAYS</div><h2>Collected</h2></div></div>
              {revenue.length === 0 ? (
                <p className="muted">No revenue recorded.</p>
              ) : (
                <dl className="overview-grid">
                  {revenue.map(([currency, minor]) => (
                    <div key={currency}><dt>{currency}</dt><dd>{formatMoney(minor, currency)}</dd></div>
                  ))}
                </dl>
              )}
            </section>
          </div>

          <section className="section-block">
            <div className="section-head"><h2>Recent audit events</h2><Link className="text-button" href="/admin/audit">Full log →</Link></div>
            <AuditTable events={data.recentAudit} />
          </section>
        </>
      )}
    </>
  );
}

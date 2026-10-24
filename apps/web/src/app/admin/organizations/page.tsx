"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { EntitlementBadge, StatusBadge } from "@/components/status-badges";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import { daysUntil, formatNumber } from "@/lib/format";
import type { AdminOrg } from "@/lib/types";

export default function AdminOrganizationsPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const params = new URLSearchParams();
  if (debounced) params.set("q", debounced);
  if (status) params.set("status", status);
  const orgs = useResource<AdminOrg[]>(`/admin/organizations?${params.toString()}`);

  return (
    <>
      <PageHeader eyebrow="ADMIN / ORGANISATIONS" title="Organisations" emphasis="& access." />
      <div className="filter-bar">
        <label className="field inline-field grow">
          <span>Search</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, slug or owner email" />
        </label>
        <label className="field inline-field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </label>
      </div>
      {orgs.loading && !orgs.data && <LoadingBlock />}
      <ErrorNotice error={orgs.error} />
      {orgs.data && orgs.data.length === 0 && <EmptyState title="No organisations match" icon="▦" />}
      {orgs.data && orgs.data.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                <th scope="col">Status</th>
                <th scope="col">Subscription</th>
                <th scope="col">Trial</th>
                <th scope="col">Access</th>
                <th scope="col">Owner</th>
                <th scope="col" className="num">Members</th>
                <th scope="col" className="num">Datasets</th>
              </tr>
            </thead>
            <tbody>
              {orgs.data.map((org) => {
                const sub = org.entitlement?.subscription;
                return (
                  <tr key={org.id}>
                    <td>
                      <Link className="table-link" href={`/admin/organizations/${org.id}`}>{org.name}</Link>
                      <div className="muted small">{org.kind === "TEAM" ? "Team" : "Individual"} · {org.slug}</div>
                    </td>
                    <td><StatusBadge status={org.status} /></td>
                    <td>{sub ? <><StatusBadge status={sub.status} /> <span className="small">{sub.planName}</span></> : <span className="muted">—</span>}</td>
                    <td>
                      {org.entitlement?.trial?.active ? (
                        <Badge tone="info">{daysUntil(org.entitlement.trial.expiresAt)}d left</Badge>
                      ) : org.trial ? (
                        <Badge>used</Badge>
                      ) : org.trialEligible ? (
                        <span className="muted small">eligible</span>
                      ) : (
                        <span className="muted small" title={org.trialIneligibleReason ?? undefined}>ineligible</span>
                      )}
                    </td>
                    <td><EntitlementBadge entitlement={org.entitlement} /></td>
                    <td>{org.owner ? <><div>{org.owner.displayName}</div><div className="muted small">{org.owner.email}</div></> : "—"}</td>
                    <td className="num">{formatNumber(org.memberCount)}</td>
                    <td className="num">{formatNumber(org.datasetCount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

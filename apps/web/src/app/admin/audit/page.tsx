"use client";

import { useEffect, useState } from "react";
import { AuditTable } from "@/components/admin/audit-table";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { ErrorNotice } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import type { AuditEvent } from "@/lib/types";

export default function AdminAuditPage() {
  const [action, setAction] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [filters, setFilters] = useState({ action: "", organizationId: "" });

  useEffect(() => {
    const id = window.setTimeout(() => setFilters({ action: action.trim(), organizationId: organizationId.trim() }), 300);
    return () => window.clearTimeout(id);
  }, [action, organizationId]);

  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.organizationId) params.set("organizationId", filters.organizationId);
  const qs = params.toString();
  const events = useResource<AuditEvent[]>(`/admin/audit${qs ? `?${qs}` : ""}`);

  return (
    <>
      <PageHeader eyebrow="ADMIN / AUDIT LOG" title="Who did" emphasis="what, when.">
        Every administrative and security-relevant action is recorded here.
      </PageHeader>
      <div className="filter-bar">
        <label className="field inline-field grow">
          <span>Action</span>
          <input type="search" value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. admin.org.trial.grant" />
        </label>
        <label className="field inline-field grow">
          <span>Organisation ID</span>
          <input type="search" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} placeholder="optional" />
        </label>
      </div>
      {events.loading && !events.data && <LoadingBlock />}
      <ErrorNotice error={events.error} />
      {events.data && <AuditTable events={events.data} />}
    </>
  );
}

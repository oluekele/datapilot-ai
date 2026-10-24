"use client";

import { useState } from "react";
import { JobsTable } from "@/components/jobs-table";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { EmptyState, ErrorNotice } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import type { AdminJob, JobStatus } from "@/lib/types";

const statuses: Array<JobStatus | ""> = ["FAILED", "QUEUED", "RUNNING", "SUCCEEDED", "CANCELED", ""];

export default function AdminJobsPage() {
  const [status, setStatus] = useState<JobStatus | "">("FAILED");
  const jobs = useResource<AdminJob[]>(`/admin/jobs${status ? `?status=${status}` : ""}`);

  return (
    <>
      <PageHeader eyebrow="ADMIN / JOBS" title="Processing" emphasis="jobs." actions={<button type="button" className="button button-light button-small" onClick={() => void jobs.reload()}>Refresh</button>} />
      <div className="filter-bar">
        <label className="field inline-field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as JobStatus | "")}>
            {statuses.map((s) => <option key={s || "all"} value={s}>{s ? s.toLowerCase() : "all"}</option>)}
          </select>
        </label>
      </div>
      {jobs.loading && !jobs.data && <LoadingBlock />}
      <ErrorNotice error={jobs.error} />
      {jobs.data && jobs.data.length === 0 && <EmptyState icon="✓" title="No jobs with this status" />}
      {jobs.data && jobs.data.length > 0 && <JobsTable jobs={jobs.data} showOrg linkDatasets={false} />}
    </>
  );
}

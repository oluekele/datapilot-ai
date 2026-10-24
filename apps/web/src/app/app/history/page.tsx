"use client";

import { LoadingBlock, PageHeader } from "@/components/page-header";
import { JobsTable } from "@/components/jobs-table";
import { EmptyState, ErrorNotice } from "@/components/ui";
import { usePolling, useResource } from "@/components/use-resource";
import type { Job } from "@/lib/types";

export default function HistoryPage() {
  const jobs = useResource<Job[]>("/jobs?limit=50");
  usePolling(!!jobs.data?.some((j) => j.status === "QUEUED" || j.status === "RUNNING"), jobs.reload, 3000);

  return (
    <>
      <PageHeader eyebrow="WORKSPACE / HISTORY" title="Every job," emphasis="on the record.">
        Profiling, repair, exploration, analysis, chart and model-training jobs for this organisation, newest first. Files they produce are collected in the Library.
      </PageHeader>
      {jobs.loading && !jobs.data && <LoadingBlock label="Loading history…" />}
      <ErrorNotice error={jobs.error} title="Couldn't load history" />
      {jobs.data && jobs.data.length === 0 && <EmptyState icon="▤" title="No jobs yet">Upload a dataset and its profiling job will appear here.</EmptyState>}
      {jobs.data && jobs.data.length > 0 && <JobsTable jobs={jobs.data} />}
    </>
  );
}

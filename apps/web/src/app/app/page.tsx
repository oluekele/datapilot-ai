"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe } from "@/components/me-provider";
import { LoadingBlock, PageHeader } from "@/components/page-header";
import { JobStatusBadge, VersionKindBadge } from "@/components/status-badges";
import { EmptyState, ErrorNotice, StatCard } from "@/components/ui";
import { UploadDropzone } from "@/components/upload-dropzone";
import { usePolling, useResource } from "@/components/use-resource";
import { formatBytes, formatNumber, formatRelative } from "@/lib/format";
import type { DatasetSummary, Me } from "@/lib/types";

function uploadDisabledReason(me: Me): string | null {
  const ent = me.entitlement;
  if (!me.activeOrganization) return "You don't have an active workspace.";
  if (me.activeOrganization.status === "SUSPENDED" || ent?.reason === "SUSPENDED") return "This organisation is suspended.";
  if (!ent?.active) return "An active subscription or trial is required to upload and process data.";
  if (ent.limits.maxDatasets > 0 && ent.usage.datasets >= ent.limits.maxDatasets) return `You've reached your plan's limit of ${ent.limits.maxDatasets} datasets.`;
  if (ent.limits.maxJobsPerMonth > 0 && ent.usage.jobsThisMonth >= ent.limits.maxJobsPerMonth) return "You've used all processing jobs for this month.";
  return null;
}

export default function DatasetsPage() {
  const { me, refresh } = useMe();
  const router = useRouter();
  const datasets = useResource<DatasetSummary[]>("/datasets");
  const anyActive = !!datasets.data?.some((d) => d.lastJob && (d.lastJob.status === "QUEUED" || d.lastJob.status === "RUNNING"));
  usePolling(anyActive, datasets.reload, 3000);
  if (!me) return null;
  const ent = me.entitlement;

  return (
    <>
      <PageHeader eyebrow="WORKSPACE / DATASETS" title="Your" emphasis="datasets.">
        Upload raw data, review its health, and create repaired versions — originals are always preserved.
      </PageHeader>

      {ent && (
        <div className="stat-grid">
          <StatCard label="DATASETS" value={<>{formatNumber(ent.usage.datasets)}<small> / {formatNumber(ent.limits.maxDatasets)}</small></>} meter={{ used: ent.usage.datasets, limit: ent.limits.maxDatasets }} />
          <StatCard label="JOBS THIS MONTH" value={<>{formatNumber(ent.usage.jobsThisMonth)}<small> / {formatNumber(ent.limits.maxJobsPerMonth)}</small></>} meter={{ used: ent.usage.jobsThisMonth, limit: ent.limits.maxJobsPerMonth }} />
          <StatCard label="PLAN" value={ent.plan?.name ?? (ent.reason === "TRIAL" ? "Free trial" : "None")} sub={`Files up to ${formatNumber(ent.limits.maxFileMb)} MB`} />
        </div>
      )}

      <UploadDropzone
        maxFileMb={ent?.limits.maxFileMb ?? 0}
        disabledReason={uploadDisabledReason(me)}
        onUploaded={(id) => {
          void refresh();
          router.push(`/app/datasets/${id}`);
        }}
      />

      <section className="section-block">
        <div className="section-head"><h2>All datasets</h2>{datasets.data && <span className="muted">{datasets.data.length} total</span>}</div>
        {datasets.loading && !datasets.data && <LoadingBlock label="Loading datasets…" />}
        <ErrorNotice error={datasets.error} title="Couldn't load datasets" />
        {datasets.data && datasets.data.length === 0 && (
          <EmptyState icon="◫" title="No datasets yet">Upload your first CSV or Excel file above to see its health report.</EmptyState>
        )}
        {datasets.data && datasets.data.length > 0 && (
          <ul className="dataset-list">
            {datasets.data.map((dataset) => (
              <li key={dataset.id}>
                <Link href={`/app/datasets/${dataset.id}`} className="dataset-row">
                  <span className="file-icon" aria-hidden="true">▦</span>
                  <span className="dataset-main">
                    <b>{dataset.name}</b>
                    <small>
                      v{dataset.latestVersion?.versionNumber ?? 1} · {dataset.versionCount} {dataset.versionCount === 1 ? "version" : "versions"} · updated {formatRelative(dataset.updatedAt)} by {dataset.createdBy?.displayName ?? "—"}
                    </small>
                  </span>
                  <span className="dataset-meta">
                    {dataset.latestVersion && <VersionKindBadge kind={dataset.latestVersion.kind} />}
                    <span className="mono-small">
                      {formatNumber(dataset.latestVersion?.rowCount)} × {formatNumber(dataset.latestVersion?.columnCount)}
                    </span>
                    <span className="mono-small">{dataset.latestVersion ? formatBytes(dataset.latestVersion.fileSizeBytes) : "—"}</span>
                    {dataset.lastJob ? <JobStatusBadge status={dataset.lastJob.status} /> : <span className="muted small">no jobs</span>}
                  </span>
                  <span className="row-arrow" aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

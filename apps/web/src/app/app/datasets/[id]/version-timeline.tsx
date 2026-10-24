"use client";

import { VersionKindBadge } from "@/components/status-badges";
import { datasetDownloadUrl, datasetReportUrl } from "@/lib/api";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import type { Job, Version } from "@/lib/types";

type Props = {
  datasetId: string;
  versions: Version[];
  jobs: Job[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function VersionTimeline({ datasetId, versions, jobs, selectedId, onSelect }: Props) {
  const ordered = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
  const byId = new Map(versions.map((v) => [v.id, v]));

  return (
    <aside className="panel timeline" aria-label="Version timeline">
      <div className="eyebrow">VERSION LINEAGE</div>
      <ol>
        {ordered.map((version) => {
          const parent = version.parentVersionId ? byId.get(version.parentVersionId) : null;
          const hasReport = jobs.some((j) => j.type === "PROFILE" && j.status === "SUCCEEDED" && j.datasetVersionId === version.id);
          const selected = version.id === selectedId;
          return (
            <li key={version.id} className={selected ? "selected" : ""}>
              <button type="button" className="timeline-select" onClick={() => onSelect(version.id)} aria-pressed={selected}>
                <span className="timeline-dot" aria-hidden="true" />
                <span className="timeline-head">
                  <b>v{version.versionNumber}</b>
                  <VersionKindBadge kind={version.kind} />
                  {parent && <small className="muted">from v{parent.versionNumber}</small>}
                </span>
                <span className="timeline-file">{version.originalFilename}</span>
                <span className="mono-small">
                  {formatNumber(version.rowCount)} rows × {formatNumber(version.columnCount)} cols · {formatBytes(version.fileSizeBytes)}
                </span>
                <small className="muted">{formatDateTime(version.createdAt)} · {version.createdBy?.displayName ?? "—"}</small>
              </button>
              <div className="timeline-actions">
                {version.purged ? (
                  <span className="muted small">Files deleted</span>
                ) : (
                  <>
                    <a className="button button-light button-small" href={datasetDownloadUrl(datasetId, version.id)} download>↓ Data</a>
                    {hasReport && <a className="button button-light button-small" href={datasetReportUrl(datasetId, version.id)} download>↓ Report</a>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="muted small">Raw uploads are immutable. Each repair creates a new version linked to its parent.</p>
    </aside>
  );
}

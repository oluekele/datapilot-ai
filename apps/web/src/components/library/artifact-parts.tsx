"use client";

import Link from "next/link";
import { Badge, ButtonLink, Modal } from "@/components/ui";
import { artifactDownloadUrl, artifactPreviewUrl } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { artifactKindMeta, jobTypeLabel } from "@/lib/labels";
import type { Artifact } from "@/lib/types";

/** File extension in upper case, e.g. "PNG", for compact labels. */
export function fileExtension(artifact: Artifact): string {
  const match = /\.([a-z0-9]+)$/i.exec(artifact.filename);
  return match ? match[1].toUpperCase() : artifact.contentType.split("/").pop()?.toUpperCase() ?? "FILE";
}

export function KindIcon({ artifact }: { artifact: Artifact }) {
  const meta = artifactKindMeta(artifact.kind);
  return <span className={`artifact-icon artifact-icon-${artifact.kind.toLowerCase()}`} aria-hidden="true">{meta.icon}</span>;
}

type ThumbProps = {
  artifact: Artifact;
  onOpen: (artifact: Artifact) => void;
  /** Optional selection checkbox (library). */
  selection?: { checked: boolean; onToggle: () => void; disabled?: boolean };
  showDataset?: boolean;
};

/** A chart card: lazy preview image (when previewable), title, and download. */
export function ChartThumb({ artifact, onOpen, selection, showDataset = false }: ThumbProps) {
  const checkboxId = `select-${artifact.id}`;
  return (
    <li className={`chart-card ${selection?.checked ? "selected" : ""}`}>
      <button type="button" className="chart-card-preview" onClick={() => onOpen(artifact)} aria-label={`Open ${artifact.title}`}>
        {artifact.previewable ? (
          // Authenticated, same-origin API image; next/image optimisation would not carry the session.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artifactPreviewUrl(artifact.id)} alt={`Chart: ${artifact.title}`} loading="lazy" decoding="async" />
        ) : (
          <span className="chart-card-placeholder">
            <KindIcon artifact={artifact} />
            <small>{fileExtension(artifact)} · no preview</small>
          </span>
        )}
      </button>
      <div className="chart-card-body">
        <div className="chart-card-title">
          {selection && (
            <input
              id={checkboxId}
              type="checkbox"
              checked={selection.checked}
              disabled={selection.disabled && !selection.checked}
              onChange={selection.onToggle}
              aria-label={`Select ${artifact.title}`}
            />
          )}
          <b title={artifact.title}>{artifact.title}</b>
        </div>
        <small className="muted">
          {showDataset ? `${artifact.datasetName} · v${artifact.versionNumber} · ` : ""}
          {fileExtension(artifact)} · {formatBytes(artifact.sizeBytes)}
        </small>
        <a className="button button-light button-small" href={artifactDownloadUrl(artifact.id)} download>↓ Download</a>
      </div>
    </li>
  );
}

/** Larger preview with provenance details and a download button. */
export function ArtifactLightbox({ artifact, onClose, onDelete }: { artifact: Artifact | null; onClose: () => void; onDelete?: (artifact: Artifact) => void }) {
  return (
    <Modal
      open={artifact !== null}
      title={artifact?.title ?? ""}
      eyebrow={artifact ? `${artifactKindMeta(artifact.kind).label.toUpperCase()} · ${fileExtension(artifact)}` : undefined}
      onClose={onClose}
      size="wide"
      footer={
        artifact && (
          <div className="button-row">
            <ButtonLink external href={artifactDownloadUrl(artifact.id)} download>↓ Download {fileExtension(artifact)}</ButtonLink>
            {onDelete && (
              <button type="button" className="button button-danger" onClick={() => onDelete(artifact)}>Delete</button>
            )}
          </div>
        )
      }
    >
      {artifact && (
        <div className="lightbox">
          {artifact.previewable ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="lightbox-image" src={artifactPreviewUrl(artifact.id)} alt={`Chart: ${artifact.title}`} />
          ) : (
            <p className="muted small">No inline preview is available for this file type — download it to view.</p>
          )}
          {typeof artifact.metadata?.description === "string" && <p className="muted">{artifact.metadata.description}</p>}
          <dl className="lightbox-meta">
            <div><dt>Dataset</dt><dd><Link className="table-link" href={`/app/datasets/${encodeURIComponent(artifact.datasetId)}?tab=outputs`}>{artifact.datasetName}</Link></dd></div>
            <div><dt>Version</dt><dd>v{artifact.versionNumber}</dd></div>
            <div><dt>Produced by</dt><dd>{jobTypeLabel(artifact.jobType)} job</dd></div>
            <div><dt>Created</dt><dd>{formatDateTime(artifact.createdAt)} · {artifact.createdBy?.displayName ?? "—"}</dd></div>
            <div><dt>File</dt><dd className="mono-wrap">{artifact.filename} · {formatBytes(artifact.sizeBytes)}</dd></div>
          </dl>
        </div>
      )}
    </Modal>
  );
}

/** Compact file card used for non-chart outputs of a single job. */
export function FileCard({ artifact, emphasis = false, description }: { artifact: Artifact; emphasis?: boolean; description?: string }) {
  return (
    <li className={`file-card ${emphasis ? "file-card-emphasis" : ""}`}>
      <KindIcon artifact={artifact} />
      <div className="file-card-main">
        <b>{artifact.title}</b>
        <small className="muted">
          <Badge>{artifactKindMeta(artifact.kind).label.toLowerCase()}</Badge> {fileExtension(artifact)} · {formatBytes(artifact.sizeBytes)}
        </small>
        {description && <small className="muted">{description}</small>}
      </div>
      <a className={`button ${emphasis ? "button-dark" : "button-light"} button-small`} href={artifactDownloadUrl(artifact.id)} download aria-label={`Download ${artifact.title}`}>
        ↓ Download
      </a>
    </li>
  );
}

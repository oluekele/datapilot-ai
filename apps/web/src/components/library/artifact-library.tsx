"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { redirectToLogin, useMe } from "@/components/me-provider";
import { LoadingBlock } from "@/components/page-header";
import { Badge, Button, EmptyState, ErrorNotice, Modal, Notice } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import {
  ApiError,
  ARCHIVE_LIMIT,
  artifactArchiveUrl,
  artifactArchiveUrlForIds,
  artifactDownloadUrl,
  deleteArtifact,
  listArtifacts,
} from "@/lib/api";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { artifactKindMeta, artifactKinds, jobTypeLabel } from "@/lib/labels";
import type { Artifact, ArtifactKind, DatasetSummary } from "@/lib/types";
import { ArtifactLightbox, ChartThumb, fileExtension, KindIcon } from "./artifact-parts";

const PAGE_SIZE = 48;

type Props = {
  /** Restrict the library to one dataset (the dataset's Outputs tab). */
  datasetId?: string;
};

/**
 * The downloads library: every artifact (charts, tables, models, reports, code,
 * data) newest first, with filters, cursor pagination, selection → ZIP, and delete.
 * Used by /app/library and by the dataset workspace's Outputs tab.
 */
export function ArtifactLibrary({ datasetId }: Props) {
  const { me } = useMe();
  const [kind, setKind] = useState<ArtifactKind | null>(null);
  const [datasetFilter, setDatasetFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<Artifact[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Artifact | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Artifact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const datasets = useResource<DatasetSummary[]>(datasetId ? null : "/datasets");
  const effectiveDataset = datasetId ?? (datasetFilter || undefined);
  const filters = useMemo(
    () => ({ datasetId: effectiveDataset, kind: kind ?? undefined, q: debouncedQuery || undefined }),
    [effectiveDataset, kind, debouncedQuery],
  );
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (err instanceof ApiError && err.status === 401) {
      redirectToLogin();
      return;
    }
    setError(err);
  }, []);

  // First page whenever the filters change.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listArtifacts(filters, { limit: PAGE_SIZE, signal: controller.signal })
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setSelected(new Set());
      })
      .catch(handleError)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, reloadKey, handleError]);

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    const requested = filters;
    setLoadingMore(true);
    try {
      const page = await listArtifacts(requested, { limit: PAGE_SIZE, cursor: nextCursor });
      if (filtersRef.current !== requested) return;
      setItems((current) => {
        const seen = new Set(current.map((a) => a.id));
        return [...current, ...page.items.filter((a) => !seen.has(a.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      handleError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  const role = me?.activeOrganization?.role;
  const canDelete = (artifact: Artifact) =>
    role === "OWNER" || role === "ADMIN" || artifact.createdBy?.displayName === me?.user.displayName;

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < ARCHIVE_LIMIT) next.add(id);
      return next;
    });
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteArtifact(pendingDelete.id);
      const id = pendingDelete.id;
      setItems((current) => current.filter((a) => a.id !== id));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (open?.id === id) setOpen(null);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleting(false);
    }
  }

  const charts = items.filter((a) => a.kind === "CHART");
  const files = items.filter((a) => a.kind !== "CHART");
  const selectionFull = selected.size >= ARCHIVE_LIMIT;
  const hasFilters = !!(kind || datasetFilter || debouncedQuery);
  const kindLabel = kind ? artifactKindMeta(kind).plural.toLowerCase() : "outputs";
  // The archive endpoint filters by dataset/kind but not by text, so a search downloads what is listed.
  const downloadAllHref = debouncedQuery
    ? items.length > 0 ? artifactArchiveUrlForIds(items.map((a) => a.id)) : null
    : items.length > 0 ? artifactArchiveUrl({ datasetId: effectiveDataset, kind: kind ?? undefined }) : null;

  return (
    <div className="library">
      <div className="library-filters">
        <div className="kind-filter" role="group" aria-label="Filter by kind">
          <button type="button" className={`chip ${kind === null ? "active" : ""}`} aria-pressed={kind === null} onClick={() => setKind(null)}>All</button>
          {artifactKinds.map((meta) => (
            <button
              key={meta.kind}
              type="button"
              className={`chip ${kind === meta.kind ? "active" : ""}`}
              aria-pressed={kind === meta.kind}
              onClick={() => setKind(meta.kind)}
            >
              <span aria-hidden="true">{meta.icon}</span> {meta.plural}
            </button>
          ))}
        </div>
        <div className="filter-bar library-filter-row">
          {!datasetId && (
            <div className="field inline-field grow">
              <label htmlFor="library-dataset">Dataset</label>
              <select id="library-dataset" value={datasetFilter} onChange={(e) => setDatasetFilter(e.target.value)}>
                <option value="">All datasets</option>
                {(datasets.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="field inline-field grow">
            <label htmlFor={datasetId ? "outputs-search" : "library-search"}>Search</label>
            <input
              id={datasetId ? "outputs-search" : "library-search"}
              type="search"
              placeholder="Title or file name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="button-row library-bulk">
            {downloadAllHref && (
              <a className="button button-light button-small" href={downloadAllHref} download title={`ZIP of up to ${ARCHIVE_LIMIT} files`}>
                ↓ Download all {debouncedQuery ? "shown" : kindLabel} (.zip)
              </a>
            )}
            <button type="button" className="button button-ghost button-small" onClick={() => setReloadKey((k) => k + 1)}>Refresh</button>
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="selection-bar" role="region" aria-label="Selection">
          <span><b>{selected.size}</b> selected{selectionFull ? ` (maximum ${ARCHIVE_LIMIT})` : ""}</span>
          <div className="button-row">
            <a className="button button-dark button-small" href={artifactArchiveUrlForIds([...selected])} download>↓ Download selected (.zip)</a>
            <button type="button" className="text-button" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <ErrorNotice error={error} title="Couldn't load outputs" />

      {loading && items.length === 0 && <LoadingBlock label="Loading outputs…" />}

      {!loading && !error && items.length === 0 && (
        hasFilters ? (
          <EmptyState icon="⌕" title="Nothing matches these filters">Try another kind, dataset or search term.</EmptyState>
        ) : (
          <EmptyState icon="▣" title={datasetId ? "No outputs for this dataset yet" : "Your library is empty"}>
            Outputs are created when you run <b>Explore</b>, <b>Analyse</b>, <b>Visualise</b> or <b>Train</b> on a dataset version. Charts, tables, trained models, reports and code all land here, ready to download.
          </EmptyState>
        )
      )}

      {charts.length > 0 && (
        <section aria-labelledby={`${datasetId ?? "library"}-charts`}>
          <div className="subhead-row">
            <h2 className="subhead" id={`${datasetId ?? "library"}-charts`}>Charts <span className="muted small">({charts.length}{nextCursor ? "+" : ""})</span></h2>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelected((current) => {
                const next = new Set(current);
                for (const a of charts) if (next.size < ARCHIVE_LIMIT) next.add(a.id);
                return next;
              })}
            >
              Select all charts
            </button>
          </div>
          <ul className="chart-grid">
            {charts.map((artifact) => (
              <ChartThumb
                key={artifact.id}
                artifact={artifact}
                onOpen={setOpen}
                showDataset={!datasetId}
                selection={{ checked: selected.has(artifact.id), onToggle: () => toggle(artifact.id), disabled: selectionFull }}
              />
            ))}
          </ul>
        </section>
      )}

      {files.length > 0 && (
        <section aria-labelledby={`${datasetId ?? "library"}-files`}>
          <h2 className="subhead" id={`${datasetId ?? "library"}-files`}>Files <span className="muted small">({files.length}{nextCursor ? "+" : ""})</span></h2>
          <div className="table-wrap">
            <table className="data-table files-table">
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">Select</span></th>
                  <th scope="col">File</th>
                  <th scope="col">Kind</th>
                  {!datasetId && <th scope="col">Dataset</th>}
                  <th scope="col">Created</th>
                  <th scope="col" className="num">Size</th>
                  <th scope="col" className="actions-cell"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {files.map((artifact) => (
                  <tr key={artifact.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(artifact.id)}
                        disabled={selectionFull && !selected.has(artifact.id)}
                        onChange={() => toggle(artifact.id)}
                        aria-label={`Select ${artifact.title}`}
                      />
                    </td>
                    <th scope="row">
                      <div className="file-cell">
                        <KindIcon artifact={artifact} />
                        <div>
                          <b>{artifact.title}</b>
                          <small className="mono-wrap muted">{artifact.filename}</small>
                        </div>
                      </div>
                    </th>
                    <td><Badge>{artifactKindMeta(artifact.kind).label.toLowerCase()}</Badge> <small className="muted">{fileExtension(artifact)}</small></td>
                    {!datasetId && (
                      <td>
                        <Link className="table-link" href={`/app/datasets/${encodeURIComponent(artifact.datasetId)}?tab=outputs`}>{artifact.datasetName}</Link>
                        <small className="muted"> · v{artifact.versionNumber} · {jobTypeLabel(artifact.jobType)}</small>
                      </td>
                    )}
                    <td className="nowrap" title={formatDateTime(artifact.createdAt)}>{formatRelative(artifact.createdAt)}<br /><small className="muted">{artifact.createdBy?.displayName ?? "—"}</small></td>
                    <td className="num">{formatBytes(artifact.sizeBytes)}</td>
                    <td className="actions-cell">
                      <div className="button-row row-actions">
                        <a className="button button-light button-small" href={artifactDownloadUrl(artifact.id)} download aria-label={`Download ${artifact.title}`}>↓</a>
                        {canDelete(artifact) && (
                          <button type="button" className="button button-danger button-small" onClick={() => setPendingDelete(artifact)} aria-label={`Delete ${artifact.title}`}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {nextCursor && (
        <div className="load-more">
          <Button variant="light" loading={loadingMore} onClick={() => void loadMore()}>Load more</Button>
        </div>
      )}

      <ArtifactLightbox
        artifact={open}
        onClose={() => setOpen(null)}
        onDelete={open && canDelete(open) ? (artifact) => { setOpen(null); setPendingDelete(artifact); } : undefined}
      />

      <Modal
        open={pendingDelete !== null}
        title="Delete this output?"
        eyebrow="PERMANENT ACTION"
        onClose={() => { setPendingDelete(null); setDeleteError(null); }}
        locked={deleting}
        footer={
          <div className="button-row">
            <Button variant="ghost" onClick={() => { setPendingDelete(null); setDeleteError(null); }} disabled={deleting}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>Delete</Button>
          </div>
        }
      >
        <p><b>{pendingDelete?.title}</b> ({pendingDelete?.filename}) will be deleted for everyone in this workspace. The dataset and the job that produced it are not affected.</p>
        {deleteError ? <ErrorNotice error={deleteError} /> : <Notice tone="warn">This cannot be undone.</Notice>}
      </Modal>
    </div>
  );
}

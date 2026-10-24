"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { JobStatusBadge } from "@/components/status-badges";
import { Badge, Button, ErrorNotice, Notice } from "@/components/ui";
import { runOperation } from "@/lib/api";
import { formatDateTime, formatDuration, formatNumber, formatRelative } from "@/lib/format";
import { columnKindLabels, jobTypeLabel } from "@/lib/labels";
import type { ColumnKind, Job, OperationParams, OperationType, ProfileResult, Version } from "@/lib/types";

export const isActiveJob = (job: Job) => job.status === "QUEUED" || job.status === "RUNNING";

// ---------------------------------------------------------------------------
// Context shared by every operation tab
// ---------------------------------------------------------------------------

export type ColumnInfo = { name: string; kind: ColumnKind };

export type OperationTabProps = {
  datasetId: string;
  version: Version;
  /** Jobs of this tab's operation on the selected version, newest first. */
  jobs: Job[];
  /** Column kinds from the latest successful profile, or null when there is none. */
  columns: ColumnInfo[] | null;
  canProcess: boolean;
  onCreated: () => Promise<void>;
  /** Shown instead of the form when there is no profile yet. */
  profileGate: ReactNode;
};

/** Columns and kinds from a profile; falls back to the pandas dtype on profiles made before v1.1. */
export function columnsFromProfile(profile: ProfileResult): ColumnInfo[] {
  if (profile.columnKinds && Object.keys(profile.columnKinds).length > 0) {
    return Object.entries(profile.columnKinds).map(([name, kind]) => ({ name, kind }));
  }
  return (profile.columns ?? []).map((col) => {
    const type = col.data_type.toLowerCase();
    let kind: ColumnKind = "categorical";
    if (col.missing_percentage >= 100) kind = "empty";
    else if (type.startsWith("bool")) kind = "boolean";
    else if (type.includes("datetime")) kind = "datetime";
    else if (/int|float|double|decimal/.test(type)) kind = "numeric";
    return { name: col.column, kind };
  });
}

export const columnsOfKind = (columns: ColumnInfo[], ...kinds: ColumnKind[]) => columns.filter((c) => kinds.includes(c.kind));

/** Kinds usable as groups / categories in tests and charts. */
export const GROUP_KINDS: ColumnKind[] = ["categorical", "boolean"];

// ---------------------------------------------------------------------------
// Running an operation
// ---------------------------------------------------------------------------

export function useOperationRunner<O extends OperationType>(datasetId: string, versionId: string, operation: O, onCreated: () => Promise<void>) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(
    async (params: OperationParams[O]): Promise<Job | null> => {
      setSubmitting(true);
      setError(null);
      try {
        const job = await runOperation(datasetId, versionId, operation, params);
        await onCreated();
        return job;
      } catch (err) {
        setError(err);
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [datasetId, versionId, operation, onCreated],
  );

  return { run, submitting, error, setError };
}

/**
 * Which run to show. By default the newest run; the user can pick an older one.
 * When the newest run is still going or failed, the last successful run is shown
 * underneath so the page never goes blank.
 */
export function useRunSelection(jobs: Job[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null, [jobs, selectedId]);
  const explicit = selectedId !== null && selected?.id === selectedId;
  const fallback = useMemo(() => {
    if (!selected || selected.status === "SUCCEEDED" || explicit) return null;
    return jobs.find((j) => j.status === "SUCCEEDED" && j.result) ?? null;
  }, [jobs, selected, explicit]);
  return {
    selected,
    fallback,
    select: setSelectedId,
    /** Call after starting a run so the newest one is shown. */
    showLatest: () => setSelectedId(null),
  };
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

export function OperationIntro({ eyebrow, title, children, when }: { eyebrow: string; title: string; children: ReactNode; when: ReactNode }) {
  return (
    <div className="op-intro">
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{children}</p>
      <p className="op-when"><b>Use it when</b> {when}</p>
    </div>
  );
}

type RunBarProps = {
  canProcess: boolean;
  submitting: boolean;
  /** A run of this operation is queued or running on this version. */
  busy: boolean;
  purged: boolean;
  /** Validation message; disables the button and is shown next to it. */
  invalid?: string | null;
  label: string;
  onRun: () => void;
};

export function RunBar({ canProcess, submitting, busy, purged, invalid, label, onRun }: RunBarProps) {
  const reason = !canProcess
    ? "Running analyses needs an active subscription or trial. Existing results stay available."
    : purged
      ? "This version's files were deleted, so it can't be processed."
      : busy
        ? "A run is already in progress for this version — it updates automatically."
        : invalid ?? null;
  return (
    <div className="run-bar">
      <span className={`small ${!canProcess || invalid ? "run-bar-reason" : "muted"}`} id={`run-reason-${label.replace(/\W+/g, "-")}`}>
        {reason ?? "Runs in the background and counts as one job toward your monthly plan."}
      </span>
      <Button
        loading={submitting}
        disabled={!canProcess || busy || purged || !!invalid}
        aria-describedby={`run-reason-${label.replace(/\W+/g, "-")}`}
        onClick={onRun}
      >
        {label} <span aria-hidden="true">→</span>
      </Button>
    </div>
  );
}

/** Status of one run: progress while queued/running, the error when it failed. */
export function RunState({ job }: { job: Job }) {
  if (job.status === "QUEUED" || job.status === "RUNNING") {
    return (
      <Notice tone="info" title={job.status === "QUEUED" ? `${jobTypeLabel(job.type)} queued` : `${jobTypeLabel(job.type)} running…`}>
        Started {formatRelative(job.createdAt)}. Results appear here automatically.
      </Notice>
    );
  }
  if (job.status === "FAILED") {
    return <Notice tone="bad" title="This run failed">{job.errorMessage ?? "The job failed without a message."}</Notice>;
  }
  if (job.status === "CANCELED") return <Notice tone="warn" title="This run was cancelled" />;
  return null;
}

type RunHistoryProps = {
  jobs: Job[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** One-line summary of a run's parameters. */
  describe: (job: Job) => string;
};

export function RunHistory({ jobs, selectedId, onSelect, describe }: RunHistoryProps) {
  if (jobs.length === 0) return null;
  return (
    <details className="run-history" open={jobs.length > 1}>
      <summary>
        <span className="eyebrow">RUN HISTORY</span> <span className="muted small">{jobs.length} {jobs.length === 1 ? "run" : "runs"} on this version</span>
      </summary>
      <ol>
        {jobs.map((job) => {
          const selected = job.id === selectedId;
          return (
            <li key={job.id}>
              <button type="button" className={`run-item ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => onSelect(job.id)}>
                <span className="run-item-head">
                  <JobStatusBadge status={job.status} />
                  <b>{formatDateTime(job.createdAt)}</b>
                  <small className="muted">{job.createdBy?.displayName ?? "—"} · {formatDuration(job.startedAt, job.finishedAt)}</small>
                </span>
                <span className="run-item-desc">{describe(job)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** Heading for the result area, noting when an older run is displayed. */
export function ResultHeading({ job, latest, note }: { job: Job; latest: Job | null; note?: string }) {
  return (
    <div className="result-head">
      <div>
        <div className="eyebrow">RESULT · {formatDateTime(job.finishedAt ?? job.createdAt)}</div>
        {(note || (latest && latest.id !== job.id)) && (
          <p className="muted small">{note ?? "You are viewing an earlier run. Pick another in the run history."}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function ColumnOption({ column }: { column: ColumnInfo }) {
  return <option value={column.name}>{column.name} · {columnKindLabels[column.kind]}</option>;
}

type ColumnSelectProps = {
  id: string;
  label: string;
  columns: ColumnInfo[];
  value: string;
  onChange: (value: string) => void;
  /** Placeholder option label when the field may be left empty. */
  optionalLabel?: string;
  hint?: ReactNode;
  emptyMessage?: string;
};

/** Single-column picker. Pass already-filtered columns (e.g. numeric only). */
export function ColumnSelect({ id, label, columns, value, onChange, optionalLabel, hint, emptyMessage }: ColumnSelectProps) {
  const hintId = `${id}-hint`;
  const noOptions = columns.length === 0;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint || noOptions ? hintId : undefined} disabled={noOptions && !optionalLabel}>
        {optionalLabel !== undefined ? <option value="">{optionalLabel}</option> : <option value="" disabled>Choose a column…</option>}
        {columns.map((c) => <ColumnOption key={c.name} column={c} />)}
      </select>
      {(hint || noOptions) && (
        <small id={hintId} className="field-hint">{noOptions ? emptyMessage ?? "No suitable columns in this version." : hint}</small>
      )}
    </div>
  );
}

type ColumnChecklistProps = {
  legend: string;
  columns: ColumnInfo[];
  value: string[];
  onChange: (value: string[]) => void;
  hint?: ReactNode;
  max?: number;
};

/** Multi-column picker as a wrap of checkbox chips with select-all / clear. */
export function ColumnChecklist({ legend, columns, value, onChange, hint, max }: ColumnChecklistProps) {
  const chosen = new Set(value);
  const full = max !== undefined && chosen.size >= max;
  function toggle(name: string): void {
    if (chosen.has(name)) onChange(value.filter((v) => v !== name));
    else if (!full) onChange([...value, name]);
  }
  return (
    <fieldset className="check-group">
      <legend>{legend}</legend>
      <div className="check-group-actions">
        <button type="button" className="text-button" onClick={() => onChange(columns.slice(0, max ?? columns.length).map((c) => c.name))}>Select all</button>
        <button type="button" className="text-button" onClick={() => onChange([])}>Clear</button>
        <small className="muted">{chosen.size} selected{max !== undefined ? ` · max ${max}` : ""}</small>
      </div>
      {columns.length === 0 ? (
        <p className="muted small">No suitable columns in this version.</p>
      ) : (
        <div className="check-chips">
          {columns.map((c) => (
            <label key={c.name} className={`check-chip ${chosen.has(c.name) ? "checked" : ""}`}>
              <input type="checkbox" checked={chosen.has(c.name)} disabled={full && !chosen.has(c.name)} onChange={() => toggle(c.name)} />
              <span>{c.name}</span>
              <small>{columnKindLabels[c.kind]}</small>
            </label>
          ))}
        </div>
      )}
      {hint && <small className="field-hint">{hint}</small>}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Format any table cell: numbers get sensible precision, objects become JSON. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (Number.isInteger(value)) return formatNumber(value);
    const abs = Math.abs(value);
    if (abs !== 0 && abs < 0.001) return value.toExponential(2);
    return formatNumber(value, abs < 1 ? 4 : 2);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const humanise = (key: string) => key.replace(/_/g, " ");

/** Generic table for engine-produced rows (Record<string, unknown>[]). */
export function RecordTable({ rows, caption }: { rows: Array<Record<string, unknown>>; caption?: string }) {
  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const row of rows) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
    return keys;
  }, [rows]);
  if (rows.length === 0) return <p className="muted small">No rows.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((key) => {
              const numeric = rows.every((r) => r[key] === null || r[key] === undefined || typeof r[key] === "number");
              return <th scope="col" key={key} className={numeric ? "num" : undefined}>{humanise(key)}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((key, col) => {
                const value = row[key];
                const content = formatCell(value);
                if (col === 0) return <th scope="row" key={key}>{content}</th>;
                return <td key={key} className={typeof value === "number" ? "num" : undefined}>{content}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bar (0–1 share) used for frequencies, missingness and importances. */
export function ShareBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <span className="share-bar" role="img" aria-label={label}>
      <em style={{ width: `${pct}%` }} />
    </span>
  );
}

export function KindCounts({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return (
    <div className="button-row">
      {entries.map(([kind, n]) => (
        <Badge key={kind} tone="neutral">{n} {columnKindLabels[kind as ColumnKind] ?? kind}</Badge>
      ))}
    </div>
  );
}

export function OperationError({ error }: { error: unknown }) {
  return <ErrorNotice error={error} title="Couldn't start the run" />;
}

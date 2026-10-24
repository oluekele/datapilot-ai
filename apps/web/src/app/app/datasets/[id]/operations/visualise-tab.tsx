"use client";

import { useState } from "react";
import { JobArtifacts } from "@/components/library/job-artifacts";
import { Button } from "@/components/ui";
import { chartTypes } from "@/lib/labels";
import type { Aggregation, ChartFilter, ChartFormat, ChartSpec, ChartType, Job, VisualizeParams, VisualizeResult } from "@/lib/types";
import {
  type ColumnInfo,
  ColumnOption,
  ColumnSelect,
  columnsOfKind,
  GROUP_KINDS,
  isActiveJob,
  OperationError,
  OperationIntro,
  type OperationTabProps,
  ResultHeading,
  RunBar,
  RunHistory,
  RunState,
  useOperationRunner,
  useRunSelection,
} from "./shared";

const MAX_CHARTS = 12;
const MAX_FILTERS = 3;
const AGGREGATIONS: Aggregation[] = ["count", "mean", "median", "sum", "min", "max"];

type FilterDraft = { column: string; values: string; min: string; max: string };
type Draft = {
  chartType: ChartType;
  x: string;
  y: string;
  group: string;
  aggregation: Aggregation;
  bins: number;
  title: string;
  filters: FilterDraft[];
};

const emptyDraft = (): Draft => ({ chartType: "histogram", x: "", y: "", group: "", aggregation: "count", bins: 20, title: "", filters: [] });

const typeLabel = (type: ChartType) => chartTypes.find((c) => c.type === type)?.label ?? type;

/** Which fields a chart type uses, mirroring the engine's validation rules. */
function fieldsFor(type: ChartType) {
  return {
    x: type === "histogram" || type === "box" || type === "bar" || type === "scatter" || type === "line",
    y: type === "box" || type === "bar" || type === "scatter" || type === "line",
    group: type === "histogram" || type === "bar" || type === "scatter" || type === "line",
    aggregation: type === "bar" || type === "line",
    bins: type === "histogram",
  };
}

function toSpec(draft: Draft): ChartSpec {
  const f = fieldsFor(draft.chartType);
  const filters: ChartFilter[] = draft.filters
    .filter((flt) => flt.column)
    .map((flt) => {
      const values = flt.values.split(",").map((v) => v.trim()).filter(Boolean);
      const min = flt.min.trim() === "" ? undefined : Number(flt.min);
      const max = flt.max.trim() === "" ? undefined : Number(flt.max);
      return {
        column: flt.column,
        ...(values.length ? { values } : {}),
        ...(min !== undefined && Number.isFinite(min) ? { minValue: min } : {}),
        ...(max !== undefined && Number.isFinite(max) ? { maxValue: max } : {}),
      };
    });
  return {
    chartType: draft.chartType,
    ...(f.x && draft.x ? { x: draft.x } : {}),
    ...(f.y && draft.y ? { y: draft.y } : {}),
    ...(f.group && draft.group ? { group: draft.group } : {}),
    ...(f.aggregation ? { aggregation: draft.aggregation } : {}),
    ...(f.bins ? { bins: draft.bins } : {}),
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    ...(filters.length ? { filters } : {}),
  };
}

function fromSpec(spec: ChartSpec): Draft {
  return {
    chartType: spec.chartType,
    x: spec.x ?? "",
    y: spec.y ?? "",
    group: spec.group ?? "",
    aggregation: spec.aggregation ?? "count",
    bins: spec.bins ?? 20,
    title: spec.title ?? "",
    filters: (spec.filters ?? []).map((f) => ({
      column: f.column,
      values: (f.values ?? []).join(", "),
      min: f.minValue === undefined ? "" : String(f.minValue),
      max: f.maxValue === undefined ? "" : String(f.maxValue),
    })),
  };
}

function validate(draft: Draft): string | null {
  switch (draft.chartType) {
    case "histogram":
      if (!draft.x) return "A histogram needs a numeric column.";
      if (!(draft.bins >= 2 && draft.bins <= 200)) return "Bins must be between 2 and 200.";
      break;
    case "box":
      if (!draft.y) return "A box plot needs a numeric value column.";
      break;
    case "bar":
      if (!draft.x) return "A bar chart needs a category column.";
      if (draft.aggregation !== "count" && !draft.y) return `Aggregating with “${draft.aggregation}” needs a numeric value column.`;
      break;
    case "scatter":
      if (!draft.x || !draft.y) return "A scatter plot needs two numeric columns.";
      break;
    case "line":
      if (!draft.x || !draft.y) return "A line chart needs an x column and a numeric value column.";
      break;
    case "correlation_heatmap":
      break;
  }
  if (draft.group && (draft.group === draft.x || draft.group === draft.y)) return "The colour-by column must differ from the axes.";
  for (const flt of draft.filters) {
    if (!flt.column) continue;
    if (flt.min.trim() && !Number.isFinite(Number(flt.min))) return `Filter on ${flt.column}: the minimum must be a number.`;
    if (flt.max.trim() && !Number.isFinite(Number(flt.max))) return `Filter on ${flt.column}: the maximum must be a number.`;
  }
  return null;
}

export function describeSpec(spec: ChartSpec): string {
  const parts: string[] = [];
  if (spec.chartType === "bar" || spec.chartType === "line") {
    parts.push(spec.aggregation && spec.aggregation !== "count" && spec.y ? `${spec.aggregation} of ${spec.y} by ${spec.x}` : `rows by ${spec.x}`);
  } else if (spec.chartType === "scatter") {
    parts.push(`${spec.y} vs ${spec.x}`);
  } else if (spec.chartType === "box") {
    parts.push(spec.x ? `${spec.y} by ${spec.x}` : `${spec.y}`);
  } else if (spec.chartType === "histogram") {
    parts.push(`${spec.x}, ${spec.bins ?? 20} bins`);
  } else {
    parts.push("all numeric columns");
  }
  if (spec.group) parts.push(`coloured by ${spec.group}`);
  if (spec.filters?.length) parts.push(`${spec.filters.length} filter${spec.filters.length > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

function describeRun(job: Job): string {
  const params = job.parameters as Partial<VisualizeParams>;
  const charts = params.charts ?? [];
  const formats = (params.formats ?? ["png"]).join(" + ").toUpperCase();
  return `${charts.length} chart${charts.length === 1 ? "" : "s"} (${charts.map((c) => typeLabel(c.chartType).toLowerCase()).join(", ")}) · ${formats}`;
}

export function VisualiseTab({ datasetId, version, jobs, columns, canProcess, onCreated, profileGate }: OperationTabProps) {
  const [specs, setSpecs] = useState<ChartSpec[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<number | null>(null);
  const [formats, setFormats] = useState<ChartFormat[]>(["png"]);
  const runner = useOperationRunner(datasetId, version.id, "VISUALIZE", onCreated);
  const selection = useRunSelection(jobs);
  const busy = jobs.some(isActiveJob);

  const all = columns ?? [];
  const numeric = columnsOfKind(all, "numeric");
  const groups = columnsOfKind(all, ...GROUP_KINDS);
  const fields = fieldsFor(draft.chartType);
  const draftError = validate(draft);
  const full = specs.length >= MAX_CHARTS && editing === null;

  const xColumns: ColumnInfo[] =
    draft.chartType === "histogram" || draft.chartType === "scatter"
      ? numeric
      : draft.chartType === "box" || draft.chartType === "bar"
        ? groups
        : columnsOfKind(all, "datetime", "numeric", ...GROUP_KINDS);

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function saveDraft(): void {
    if (draftError) return;
    const spec = toSpec(draft);
    setSpecs((list) => (editing === null ? [...list, spec] : list.map((s, i) => (i === editing ? spec : s))));
    setEditing(null);
    setDraft((d) => ({ ...emptyDraft(), chartType: d.chartType }));
  }

  function move(index: number, delta: number): void {
    setSpecs((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    if (editing === index) setEditing(index + delta);
  }

  function remove(index: number): void {
    setSpecs((list) => list.filter((_, i) => i !== index));
    if (editing === index) {
      setEditing(null);
      setDraft(emptyDraft());
    }
  }

  function toggleFormat(format: ChartFormat): void {
    setFormats((current) => (current.includes(format) ? current.filter((f) => f !== format) : [...current, format]));
  }

  const runInvalid = specs.length === 0 ? "Add at least one chart to the list." : formats.length === 0 ? "Choose at least one file format." : null;

  async function run(): Promise<void> {
    if (runInvalid) return;
    if (await runner.run({ charts: specs, formats })) selection.showLatest();
  }

  return (
    <>
      <section className="panel">
        <OperationIntro
          eyebrow="CHART BUILDER"
          title="Visualise"
          when="you know which charts you need — for a report, a slide or to check an idea — and want clean, consistent, downloadable images."
        >
          Design up to {MAX_CHARTS} charts, then render them together as PNG and/or SVG files. Every chart is saved to your Library.
        </OperationIntro>

        {!columns ? profileGate : (
          <div className="op-form">
            <div className="builder">
              <div className="builder-form" aria-labelledby="chart-draft-title">
                <h3 className="subhead" id="chart-draft-title">{editing === null ? "New chart" : `Editing chart ${editing + 1}`}</h3>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="chart-type">Chart type</label>
                    <select id="chart-type" value={draft.chartType} onChange={(e) => setDraft((d) => ({ ...d, chartType: e.target.value as ChartType, x: "", y: "", group: "" }))} aria-describedby="chart-type-hint">
                      {chartTypes.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
                    </select>
                    <small id="chart-type-hint" className="field-hint">{chartTypes.find((c) => c.type === draft.chartType)?.description}</small>
                  </div>
                  {fields.x && (
                    <ColumnSelect
                      id="chart-x"
                      label={draft.chartType === "box" ? "Split by (optional)" : draft.chartType === "bar" ? "Categories (x)" : "X axis"}
                      columns={xColumns}
                      value={draft.x}
                      onChange={(v) => update("x", v)}
                      optionalLabel={draft.chartType === "box" ? "No split" : undefined}
                    />
                  )}
                  {fields.aggregation && (
                    <div className="field">
                      <label htmlFor="chart-agg">Aggregation</label>
                      <select id="chart-agg" value={draft.aggregation} onChange={(e) => update("aggregation", e.target.value as Aggregation)}>
                        {AGGREGATIONS.map((a) => <option key={a} value={a}>{a === "count" ? "count of rows" : a}</option>)}
                      </select>
                    </div>
                  )}
                  {fields.y && (
                    <ColumnSelect
                      id="chart-y"
                      label={draft.chartType === "scatter" ? "Y axis" : "Value (numeric)"}
                      columns={numeric}
                      value={draft.y}
                      onChange={(v) => update("y", v)}
                      optionalLabel={draft.chartType === "bar" && draft.aggregation === "count" ? "Not needed for counts" : undefined}
                    />
                  )}
                  {fields.group && (
                    <ColumnSelect id="chart-group" label="Colour by (optional)" columns={groups} value={draft.group} onChange={(v) => update("group", v)} optionalLabel="None" />
                  )}
                  {fields.bins && (
                    <div className="field">
                      <label htmlFor="chart-bins">Bins</label>
                      <input id="chart-bins" type="number" min={2} max={200} value={draft.bins} onChange={(e) => update("bins", Number(e.target.value))} />
                    </div>
                  )}
                  <div className="field form-grid-wide">
                    <label htmlFor="chart-title">Title (optional)</label>
                    <input id="chart-title" type="text" maxLength={120} placeholder="Generated from the columns if left empty" value={draft.title} onChange={(e) => update("title", e.target.value)} />
                  </div>
                </div>

                <FilterEditor columns={all} filters={draft.filters} onChange={(filters) => update("filters", filters)} />

                {draftError && <p className="field-hint" role="status">{draftError}</p>}
                <div className="button-row">
                  <Button variant="light" disabled={!!draftError || full} onClick={saveDraft}>
                    {editing === null ? "+ Add to list" : "Save changes"}
                  </Button>
                  {editing !== null && (
                    <button type="button" className="text-button" onClick={() => { setEditing(null); setDraft(emptyDraft()); }}>Cancel edit</button>
                  )}
                  {full && <small className="muted">The list is full ({MAX_CHARTS} charts).</small>}
                </div>
              </div>

              <div className="builder-list">
                <h3 className="subhead">Charts to render <span className="muted small">({specs.length}/{MAX_CHARTS})</span></h3>
                {specs.length === 0 ? (
                  <p className="muted small">Your list is empty. Configure a chart and choose “Add to list”.</p>
                ) : (
                  <ol className="spec-list">
                    {specs.map((spec, index) => (
                      <li key={index} className={editing === index ? "editing" : ""}>
                        <div className="spec-main">
                          <b>{index + 1}. {spec.title || typeLabel(spec.chartType)}</b>
                          <small className="muted">{typeLabel(spec.chartType)} · {describeSpec(spec)}</small>
                        </div>
                        <div className="spec-actions">
                          <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move chart ${index + 1} up`}>↑</button>
                          <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === specs.length - 1} aria-label={`Move chart ${index + 1} down`}>↓</button>
                          <button type="button" className="icon-button" onClick={() => { setEditing(index); setDraft(fromSpec(spec)); }} aria-label={`Edit chart ${index + 1}`}>✎</button>
                          <button type="button" className="icon-button danger" onClick={() => remove(index)} aria-label={`Remove chart ${index + 1}`}>×</button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                <fieldset className="format-picker">
                  <legend>File formats</legend>
                  <label className="check-row"><input type="checkbox" checked={formats.includes("png")} onChange={() => toggleFormat("png")} /> PNG <small className="muted">— previews, documents, slides</small></label>
                  <label className="check-row"><input type="checkbox" checked={formats.includes("svg")} onChange={() => toggleFormat("svg")} /> SVG <small className="muted">— sharp at any size, editable</small></label>
                </fieldset>
              </div>
            </div>

            <OperationError error={runner.error} />
            <RunBar canProcess={canProcess} submitting={runner.submitting} busy={busy} purged={version.purged} invalid={runInvalid} label={specs.length ? `Render ${specs.length} chart${specs.length === 1 ? "" : "s"}` : "Render charts"} onRun={() => void run()} />
          </div>
        )}
        <RunHistory jobs={jobs} selectedId={selection.selected?.id ?? null} onSelect={selection.select} describe={describeRun} />
      </section>

      {selection.selected && <RunState job={selection.selected} />}
      {[selection.selected, selection.fallback].map((job) =>
        job?.status === "SUCCEEDED" && job.result ? (
          <section className="panel" key={job.id} aria-label="Rendered charts">
            <ResultHeading job={job} latest={jobs[0] ?? null} note={job === selection.fallback ? "Showing the last successful run." : undefined} />
            <div className="button-row">
              {(job.parameters as Partial<VisualizeParams>).charts?.length ? (
                <button type="button" className="text-button" onClick={() => setSpecs(((job.parameters as Partial<VisualizeParams>).charts ?? []).slice(0, MAX_CHARTS))}>
                  ↺ Load these charts into the builder
                </button>
              ) : null}
            </div>
            {((job.result as VisualizeResult).charts ?? []).length > 0 && (
              <ul className="chart-notes">
                {(job.result as VisualizeResult).charts.map((c, i) => (
                  <li key={`${c.title}-${i}`}><b>{c.title}</b> — <span className="muted">{c.description}</span></li>
                ))}
              </ul>
            )}
            <JobArtifacts job={job} chartsTitle="Your charts" />
          </section>
        ) : null,
      )}
    </>
  );
}

function FilterEditor({ columns, filters, onChange }: { columns: ColumnInfo[]; filters: FilterDraft[]; onChange: (filters: FilterDraft[]) => void }) {
  const kinds = new Map(columns.map((c) => [c.name, c.kind]));
  function set(index: number, patch: Partial<FilterDraft>): void {
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  return (
    <fieldset className="filter-editor">
      <legend>Filters (optional)</legend>
      {filters.length === 0 && <p className="muted small">Chart every row, or add a filter to focus on a subset.</p>}
      {filters.map((flt, index) => {
        const numericCol = kinds.get(flt.column) === "numeric";
        return (
          <div className="filter-row" key={index}>
            <div className="field">
              <label htmlFor={`filter-col-${index}`}>Column</label>
              <select id={`filter-col-${index}`} value={flt.column} onChange={(e) => set(index, { column: e.target.value, values: "", min: "", max: "" })}>
                <option value="">Choose…</option>
                {columns.map((c) => <ColumnOption key={c.name} column={c} />)}
              </select>
            </div>
            {numericCol ? (
              <>
                <div className="field">
                  <label htmlFor={`filter-min-${index}`}>Min</label>
                  <input id={`filter-min-${index}`} type="number" inputMode="decimal" value={flt.min} onChange={(e) => set(index, { min: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`filter-max-${index}`}>Max</label>
                  <input id={`filter-max-${index}`} type="number" inputMode="decimal" value={flt.max} onChange={(e) => set(index, { max: e.target.value })} />
                </div>
              </>
            ) : (
              <div className="field filter-values">
                <label htmlFor={`filter-values-${index}`}>Keep values</label>
                <input id={`filter-values-${index}`} type="text" placeholder="e.g. North, South" value={flt.values} onChange={(e) => set(index, { values: e.target.value })} disabled={!flt.column} />
              </div>
            )}
            <button type="button" className="icon-button danger" onClick={() => onChange(filters.filter((_, i) => i !== index))} aria-label={`Remove filter ${index + 1}`}>×</button>
          </div>
        );
      })}
      {filters.length < MAX_FILTERS && (
        <button type="button" className="text-button" onClick={() => onChange([...filters, { column: "", values: "", min: "", max: "" }])}>+ Add filter</button>
      )}
    </fieldset>
  );
}

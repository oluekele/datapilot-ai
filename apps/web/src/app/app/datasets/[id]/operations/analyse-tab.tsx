"use client";

import { useState } from "react";
import { JobArtifacts } from "@/components/library/job-artifacts";
import { analyzeTests } from "@/lib/labels";
import type { AnalyzeParams, AnalyzeResult, AnalyzeTest, CorrelationMethod, Job } from "@/lib/types";
import {
  ColumnChecklist,
  ColumnSelect,
  columnsOfKind,
  formatCell,
  GROUP_KINDS,
  isActiveJob,
  OperationError,
  OperationIntro,
  type OperationTabProps,
  RecordTable,
  ResultHeading,
  RunBar,
  RunHistory,
  RunState,
  useOperationRunner,
  useRunSelection,
} from "./shared";

const ALPHAS = [0.01, 0.05, 0.1];

function describe(job: Job): string {
  const p = job.parameters as Partial<Record<string, unknown>> & { test?: AnalyzeTest };
  const label = analyzeTests.find((t) => t.test === p.test)?.label ?? String(p.test ?? "analysis");
  const cols = [p.groupColumn, p.valueColumn, p.columnA, p.columnB, p.columnX, p.columnY].filter((v): v is string => typeof v === "string");
  if (Array.isArray(p.columns) && p.columns.length) return `${label} · ${p.columns.length} columns`;
  return cols.length ? `${label} · ${cols.join(" × ")}` : label;
}

export function AnalyseTab({ datasetId, version, jobs, columns, canProcess, onCreated, profileGate }: OperationTabProps) {
  const [test, setTest] = useState<AnalyzeTest>("descriptive");
  const [descriptiveCols, setDescriptiveCols] = useState<string[]>([]);
  const [groupColumn, setGroupColumn] = useState("");
  const [valueColumn, setValueColumn] = useState("");
  const [columnA, setColumnA] = useState("");
  const [columnB, setColumnB] = useState("");
  const [columnX, setColumnX] = useState("");
  const [columnY, setColumnY] = useState("");
  const [method, setMethod] = useState<CorrelationMethod>("pearson");
  const [alpha, setAlpha] = useState(0.05);
  const runner = useOperationRunner(datasetId, version.id, "ANALYZE", onCreated);
  const selection = useRunSelection(jobs);
  const busy = jobs.some(isActiveJob);

  const numeric = columns ? columnsOfKind(columns, "numeric") : [];
  const groups = columns ? columnsOfKind(columns, ...GROUP_KINDS) : [];
  const info = analyzeTests.find((t) => t.test === test) ?? analyzeTests[0];

  function build(): { params: AnalyzeParams | null; invalid: string | null } {
    switch (test) {
      case "descriptive":
        return { params: { test, ...(descriptiveCols.length ? { columns: descriptiveCols } : {}) }, invalid: null };
      case "grouped_summary":
      case "compare_groups":
        if (!groupColumn || !valueColumn) return { params: null, invalid: "Choose a group column and a value column." };
        return {
          params: test === "compare_groups" ? { test, groupColumn, valueColumn, alpha } : { test, groupColumn, valueColumn },
          invalid: null,
        };
      case "association":
        if (!columnA || !columnB) return { params: null, invalid: "Choose two category columns." };
        if (columnA === columnB) return { params: null, invalid: "Choose two different columns." };
        return { params: { test, columnA, columnB, alpha }, invalid: null };
      case "correlation":
        if (!columnX || !columnY) return { params: null, invalid: "Choose two numeric columns." };
        if (columnX === columnY) return { params: null, invalid: "Choose two different columns." };
        return { params: { test, columnX, columnY, method, alpha }, invalid: null };
    }
  }
  const { params, invalid } = build();

  async function run(): Promise<void> {
    if (!params) return;
    if (await runner.run(params)) selection.showLatest();
  }

  const alphaField = (
    <div className="field">
      <label htmlFor="analyse-alpha">Significance level (α)</label>
      <select id="analyse-alpha" value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} aria-describedby="analyse-alpha-hint">
        {ALPHAS.map((a) => <option key={a} value={a}>{a}{a === 0.05 ? " (standard)" : ""}</option>)}
      </select>
      <small id="analyse-alpha-hint" className="field-hint">How much evidence you need before calling a result significant. Lower is stricter.</small>
    </div>
  );

  return (
    <>
      <section className="panel">
        <OperationIntro
          eyebrow="STATISTICAL TESTS"
          title="Analyse"
          when="you have a specific question — “do these groups differ?”, “are these two things related?” — and want an answer with the evidence behind it."
        >
          Run a statistical test and get a plain-language interpretation, the supporting table and a chart. DataPilot chooses a suitable variant of each test for your data and explains its assumptions.
        </OperationIntro>

        {!columns ? profileGate : (
          <div className="op-form">
            <fieldset className="test-picker">
              <legend>Choose a test</legend>
              {analyzeTests.map((t) => (
                <label key={t.test} className={`choice ${test === t.test ? "selected" : ""}`}>
                  <input type="radio" name="analyse-test" value={t.test} checked={test === t.test} onChange={() => setTest(t.test)} />
                  <b>{t.label}</b>
                  <small>{t.description}</small>
                </label>
              ))}
            </fieldset>
            <p className="muted small"><b>{info.label} needs:</b> {info.needs}</p>

            {test === "descriptive" && (
              <ColumnChecklist legend="Numeric columns (optional)" columns={numeric} value={descriptiveCols} onChange={setDescriptiveCols} hint="Leave empty to describe every numeric column." />
            )}
            {(test === "grouped_summary" || test === "compare_groups") && (
              <div className="form-grid">
                <ColumnSelect id="analyse-group" label="Group column" columns={groups} value={groupColumn} onChange={setGroupColumn} hint="A category column — each value is one group." emptyMessage="This version has no category columns." />
                <ColumnSelect id="analyse-value" label="Value column" columns={numeric} value={valueColumn} onChange={setValueColumn} hint="The numeric measure to compare." emptyMessage="This version has no numeric columns." />
                {test === "compare_groups" && alphaField}
              </div>
            )}
            {test === "association" && (
              <div className="form-grid">
                <ColumnSelect id="analyse-a" label="First column" columns={groups} value={columnA} onChange={setColumnA} emptyMessage="This version has no category columns." />
                <ColumnSelect id="analyse-b" label="Second column" columns={groups.filter((c) => c.name !== columnA)} value={columnB} onChange={setColumnB} />
                {alphaField}
              </div>
            )}
            {test === "correlation" && (
              <div className="form-grid">
                <ColumnSelect id="analyse-x" label="First column (X)" columns={numeric} value={columnX} onChange={setColumnX} emptyMessage="This version has no numeric columns." />
                <ColumnSelect id="analyse-y" label="Second column (Y)" columns={numeric.filter((c) => c.name !== columnX)} value={columnY} onChange={setColumnY} />
                <div className="field">
                  <label htmlFor="analyse-method">Method</label>
                  <select id="analyse-method" value={method} onChange={(e) => setMethod(e.target.value as CorrelationMethod)}>
                    <option value="pearson">Pearson (linear)</option>
                    <option value="spearman">Spearman (rank, robust to outliers)</option>
                  </select>
                </div>
                {alphaField}
              </div>
            )}

            <OperationError error={runner.error} />
            <RunBar canProcess={canProcess} submitting={runner.submitting} busy={busy} purged={version.purged} invalid={invalid} label="Run test" onRun={() => void run()} />
          </div>
        )}
        <RunHistory jobs={jobs} selectedId={selection.selected?.id ?? null} onSelect={selection.select} describe={describe} />
      </section>

      {selection.selected && <RunState job={selection.selected} />}
      {[selection.selected, selection.fallback].map((job) =>
        job?.status === "SUCCEEDED" && job.result ? (
          <section className="panel" key={job.id} aria-label="Analysis result">
            <ResultHeading job={job} latest={jobs[0] ?? null} note={job === selection.fallback ? "Showing the last successful run." : undefined} />
            <AnalyseResultView result={job.result as AnalyzeResult} />
            <JobArtifacts job={job} />
          </section>
        ) : null,
      )}
    </>
  );
}

function AnalyseResultView({ result }: { result: AnalyzeResult }) {
  const details = Object.entries(result.details ?? {}).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
  return (
    <div className="result-body">
      <h3 className="result-title">{result.title}</h3>
      <blockquote className="result-summary">{result.summary}</blockquote>
      {result.table && result.table.length > 0 && (
        <>
          <h3 className="subhead">Table</h3>
          <RecordTable rows={result.table} caption={result.title} />
        </>
      )}
      {details.length > 0 && (
        <>
          <h3 className="subhead">Details</h3>
          <dl className="detail-list">
            {details.map(([key, value]) => (
              <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{formatCell(value)}</dd></div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

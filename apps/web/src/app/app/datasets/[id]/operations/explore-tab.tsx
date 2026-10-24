"use client";

import { useState } from "react";
import { JobArtifacts } from "@/components/library/job-artifacts";
import { formatNumber } from "@/lib/format";
import type { CorrelationMethod, ExploreParams, ExploreResult, Job } from "@/lib/types";
import {
  asNumber,
  ColumnChecklist,
  columnsOfKind,
  GROUP_KINDS,
  isActiveJob,
  KindCounts,
  OperationError,
  OperationIntro,
  type OperationTabProps,
  ResultHeading,
  RunBar,
  RunHistory,
  RunState,
  ShareBar,
  useOperationRunner,
  useRunSelection,
} from "./shared";

function describe(job: Job): string {
  const params = job.parameters as ExploreParams;
  const method = params.correlationMethod ?? "pearson";
  const cols = params.columns?.length ? `${params.columns.length} chosen columns` : "automatic columns";
  return `${method} correlations · ${cols}`;
}

export function ExploreTab({ datasetId, version, jobs, columns, canProcess, onCreated, profileGate }: OperationTabProps) {
  const [method, setMethod] = useState<CorrelationMethod>("pearson");
  const [chosen, setChosen] = useState<string[]>([]);
  const runner = useOperationRunner(datasetId, version.id, "EXPLORE", onCreated);
  const selection = useRunSelection(jobs);
  const busy = jobs.some(isActiveJob);
  const chartable = columns ? [...columnsOfKind(columns, "numeric"), ...columnsOfKind(columns, ...GROUP_KINDS)] : [];

  async function run(): Promise<void> {
    const params: ExploreParams = { correlationMethod: method, ...(chosen.length > 0 ? { columns: chosen } : {}) };
    if (await runner.run(params)) selection.showLatest();
  }

  return (
    <>
      <section className="panel">
        <OperationIntro
          eyebrow="EXPLORATORY DATA ANALYSIS"
          title="Explore"
          when="you have a new or freshly cleaned dataset and want to understand its shape before testing ideas or building models."
        >
          A guided first look: summary statistics for every numeric column, where values are missing, the most common categories, the strongest correlations, and a set of distribution charts.
        </OperationIntro>

        {!columns ? profileGate : (
          <div className="op-form">
            <fieldset className="choice-row">
              <legend>Correlation method</legend>
              {([
                ["pearson", "Pearson", "Straight-line relationships; sensitive to outliers."],
                ["spearman", "Spearman", "Any steadily rising/falling relationship; robust to outliers."],
              ] as const).map(([value, label, help]) => (
                <label key={value} className={`choice ${method === value ? "selected" : ""}`}>
                  <input type="radio" name="explore-method" value={value} checked={method === value} onChange={() => setMethod(value)} />
                  <b>{label}</b>
                  <small>{help}</small>
                </label>
              ))}
            </fieldset>
            <ColumnChecklist
              legend="Columns to chart (optional)"
              columns={chartable}
              value={chosen}
              onChange={setChosen}
              hint="Leave empty for automatic selection (up to 12 numeric and 8 category columns)."
            />
            <OperationError error={runner.error} />
            <RunBar canProcess={canProcess} submitting={runner.submitting} busy={busy} purged={version.purged} label="Run exploration" onRun={() => void run()} />
          </div>
        )}
        <RunHistory jobs={jobs} selectedId={selection.selected?.id ?? null} onSelect={selection.select} describe={describe} />
      </section>

      {selection.selected && <RunState job={selection.selected} />}
      {[selection.selected, selection.fallback].map((job) =>
        job?.status === "SUCCEEDED" && job.result ? (
          <section className="panel" key={job.id} aria-label="Exploration result">
            <ResultHeading job={job} latest={jobs[0] ?? null} note={job === selection.fallback ? "Showing the last successful run." : undefined} />
            <ExploreResultView result={job.result as ExploreResult} />
            <JobArtifacts job={job} chartsTitle="Distribution & correlation charts" />
          </section>
        ) : null,
      )}
    </>
  );
}

function ExploreResultView({ result }: { result: ExploreResult }) {
  const { summary, missing } = result;
  const distributions = result.distributions ?? [];
  const categories = result.categories ?? [];
  const correlations = result.correlations?.top ?? [];
  const missingRows = missing?.by_column ?? [];

  return (
    <div className="result-body">
      <dl className="overview-grid">
        <div><dt>Rows</dt><dd>{formatNumber(summary?.rows)}</dd></div>
        <div><dt>Columns</dt><dd>{formatNumber(summary?.columns)}</dd></div>
        <div><dt>Complete rows</dt><dd>{formatNumber(summary?.complete_rows)} <small>({formatNumber(summary?.complete_row_percentage, 1)}%)</small></dd></div>
        <div><dt>Columns with gaps</dt><dd>{formatNumber(missing?.columns_with_missing)}</dd></div>
        <div><dt>Rows with gaps</dt><dd>{formatNumber(missing?.rows_with_missing)} <small>({formatNumber(missing?.rows_with_missing_percentage, 1)}%)</small></dd></div>
      </dl>
      {summary?.kind_counts && <KindCounts counts={summary.kind_counts} />}

      <h3 className="subhead">Missing values</h3>
      {missingRows.length === 0 ? (
        <p className="muted small">No missing values. ✓</p>
      ) : (
        <ul className="bar-list">
          {missingRows.map((row) => {
            const pct = asNumber(row.missing_percentage) ?? 0;
            return (
              <li key={row.column}>
                <code>{row.column}</code>
                <ShareBar value={pct / 100} label={`${formatNumber(pct, 1)}% missing`} />
                <span className="mono-small">{formatNumber(row.missing)} · {formatNumber(pct, 1)}%</span>
              </li>
            );
          })}
        </ul>
      )}

      {distributions.length > 0 && (
        <>
          <h3 className="subhead">Numeric distributions</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Column</th>
                  <th scope="col" className="num">Count</th>
                  <th scope="col" className="num">Mean</th>
                  <th scope="col" className="num">Std dev</th>
                  <th scope="col" className="num">Min</th>
                  <th scope="col" className="num">Q1</th>
                  <th scope="col" className="num">Median</th>
                  <th scope="col" className="num">Q3</th>
                  <th scope="col" className="num">Max</th>
                  <th scope="col" className="num">Skew</th>
                </tr>
              </thead>
              <tbody>
                {distributions.map(({ column, stats }) => (
                  <tr key={column}>
                    <th scope="row">
                      <code>{column}</code>
                      {stats?.notes?.map((note) => <small key={note} className="muted table-note">{note}</small>)}
                    </th>
                    <td className="num">{formatNumber(asNumber(stats?.count))}</td>
                    <td className="num">{formatNumber(asNumber(stats?.mean), 2)}</td>
                    <td className="num">{formatNumber(asNumber(stats?.std), 2)}</td>
                    <td className="num">{formatNumber(asNumber(stats?.min), 2)}</td>
                    <td className="num">{formatNumber(asNumber(stats?.q1), 2)}</td>
                    <td className="num">{formatNumber(asNumber(stats?.median), 2)}</td>
                    <td className="num">{formatNumber(asNumber(stats?.q3), 2)}</td>
                    <td className="num">{formatNumber(asNumber(stats?.max), 2)}</td>
                    <td className="num">{formatNumber(asNumber(stats?.skewness), 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Skew far from 0 (beyond about ±1) means a lopsided distribution — consider the median rather than the mean.</p>
        </>
      )}

      {categories.length > 0 && (
        <>
          <h3 className="subhead">Top categories</h3>
          <div className="category-grid">
            {categories.map(({ column, frequencies }) => (
              <div className="category-card" key={column}>
                <code>{column}</code>
                <ul className="bar-list compact">
                  {(frequencies ?? []).map((f) => (
                    <li key={f.value}>
                      <span className="bar-label" title={f.value}>{f.value}</span>
                      <ShareBar value={(f.percentage ?? 0) / 100} label={`${formatNumber(f.percentage, 1)}%`} />
                      <span className="mono-small">{formatNumber(f.count)} · {formatNumber(f.percentage, 1)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="subhead">Strongest correlations <span className="muted small">({result.correlations?.method ?? "pearson"})</span></h3>
      {correlations.length === 0 ? (
        <p className="muted small">Not enough numeric columns to compute correlations.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Columns</th>
                  <th scope="col" className="num">Correlation</th>
                  <th scope="col">Strength</th>
                </tr>
              </thead>
              <tbody>
                {correlations.map((pair) => (
                  <tr key={`${pair.column_a}-${pair.column_b}`}>
                    <th scope="row"><code>{pair.column_a}</code> ↔ <code>{pair.column_b}</code></th>
                    <td className="num">
                      <span className={pair.correlation >= 0 ? "corr-pos" : "corr-neg"}>{pair.correlation > 0 ? "+" : ""}{formatNumber(pair.correlation, 3)}</span>
                    </td>
                    <td>{pair.strength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Correlation shows that two columns move together, not that one causes the other.</p>
        </>
      )}
    </div>
  );
}

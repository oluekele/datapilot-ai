"use client";

import { useMemo, useState } from "react";
import { FileCard } from "@/components/library/artifact-parts";
import { JobArtifacts } from "@/components/library/job-artifacts";
import { SeverityBadge } from "@/components/status-badges";
import { Notice } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { algorithms, metricExplanation, metricLabel, metricLowerIsBetter, trainTasks } from "@/lib/labels";
import type { Artifact, ArtifactKind, Job, LeaderboardRow, TrainParams, TrainResult, TrainTask } from "@/lib/types";
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
  ResultHeading,
  RunBar,
  RunHistory,
  RunState,
  ShareBar,
  useOperationRunner,
  useRunSelection,
} from "./shared";

const algorithmLabel = (task: TrainTask, id: string) => algorithms[task]?.find((a) => a.id === id)?.label ?? id.replace(/_/g, " ");

function describe(job: Job): string {
  const p = job.parameters as Partial<TrainParams>;
  const task = p.task ?? "classification";
  const label = trainTasks.find((t) => t.task === task)?.label ?? task;
  const algos = p.algorithms?.length ? `${p.algorithms.length} algorithms` : "all algorithms";
  return `${label}${p.target ? ` → ${p.target}` : ""} · ${algos}`;
}

export function TrainTab({ datasetId, version, jobs, columns, canProcess, onCreated, profileGate }: OperationTabProps) {
  const [task, setTask] = useState<TrainTask>("classification");
  const [target, setTarget] = useState("");
  const [features, setFeatures] = useState<string[] | null>(null);
  const [chosenAlgorithms, setChosenAlgorithms] = useState<string[]>(algorithms.classification.map((a) => a.id));
  const [testSize, setTestSize] = useState(0.2);
  const [cvFolds, setCvFolds] = useState(5);
  const [nClusters, setNClusters] = useState(3);
  const runner = useOperationRunner(datasetId, version.id, "TRAIN", onCreated);
  const selection = useRunSelection(jobs);
  const busy = jobs.some(isActiveJob);

  const all = columns ?? [];
  const targetOptions = task === "regression" ? columnsOfKind(all, "numeric") : columnsOfKind(all, ...GROUP_KINDS);
  const featureCandidates = columnsOfKind(all, "numeric", "categorical", "boolean", "datetime").filter((c) => c.name !== target);
  const excluded = all.filter((c) => c.kind === "identifier" || c.kind === "text" || c.kind === "empty");
  const chosenFeatures = features ?? featureCandidates.map((c) => c.name);

  function changeTask(next: TrainTask): void {
    setTask(next);
    setTarget("");
    setChosenAlgorithms(algorithms[next].map((a) => a.id));
  }

  function changeTarget(next: string): void {
    setTarget(next);
    if (features) setFeatures(features.filter((f) => f !== next));
  }

  function toggleAlgorithm(id: string): void {
    setChosenAlgorithms((list) => (list.includes(id) ? list.filter((a) => a !== id) : [...list, id]));
  }

  const invalid =
    task !== "clustering" && !target
      ? "Choose the target column to predict."
      : chosenFeatures.length === 0
        ? "Choose at least one feature column."
        : chosenAlgorithms.length === 0
          ? "Choose at least one algorithm."
          : null;

  async function run(): Promise<void> {
    if (invalid) return;
    const allAlgorithms = chosenAlgorithms.length === algorithms[task].length;
    const allFeatures = features === null;
    const params: TrainParams =
      task === "clustering"
        ? {
            task,
            nClusters,
            ...(allAlgorithms ? {} : { algorithms: chosenAlgorithms }),
            ...(allFeatures ? {} : { features: chosenFeatures }),
          }
        : {
            task,
            target,
            testSize,
            cvFolds,
            ...(allAlgorithms ? {} : { algorithms: chosenAlgorithms }),
            ...(allFeatures ? {} : { features: chosenFeatures }),
          };
    if (await runner.run(params)) selection.showLatest();
  }

  return (
    <>
      <section className="panel">
        <OperationIntro
          eyebrow="MACHINE LEARNING"
          title="Train"
          when="you want to predict a column from the others, or discover natural groups of rows — and compare several algorithms fairly in one go."
        >
          DataPilot prepares the features, trains each algorithm you choose on the same split, scores them on held-out rows and ranks them. You can download the best model, its predictions, a reproducible Python training script and a model card.
        </OperationIntro>

        {!columns ? profileGate : (
          <div className="op-form">
            <fieldset className="choice-row three">
              <legend>What do you want to do?</legend>
              {trainTasks.map((t) => (
                <label key={t.task} className={`choice ${task === t.task ? "selected" : ""}`}>
                  <input type="radio" name="train-task" value={t.task} checked={task === t.task} onChange={() => changeTask(t.task)} />
                  <b>{t.label}</b>
                  <small>{t.description}</small>
                </label>
              ))}
            </fieldset>

            <div className="form-grid">
              {task !== "clustering" && (
                <ColumnSelect
                  id="train-target"
                  label="Target — the column to predict"
                  columns={targetOptions}
                  value={target}
                  onChange={changeTarget}
                  hint={task === "regression" ? "A numeric column." : "A category or yes/no column."}
                  emptyMessage={task === "regression" ? "This version has no numeric columns to predict." : "This version has no category columns to predict."}
                />
              )}
              {task === "clustering" ? (
                <div className="field">
                  <label htmlFor="train-k">Number of clusters</label>
                  <input id="train-k" type="number" min={2} max={20} value={nClusters} onChange={(e) => setNClusters(Math.max(2, Math.min(20, Number(e.target.value) || 2)))} aria-describedby="train-k-hint" />
                  <small id="train-k-hint" className="field-hint">Between 2 and 20. Try a few values and compare the silhouette score.</small>
                </div>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="train-test-size">Test set: {Math.round(testSize * 100)}% of rows</label>
                    <input id="train-test-size" type="range" min={0.1} max={0.5} step={0.05} value={testSize} onChange={(e) => setTestSize(Number(e.target.value))} aria-describedby="train-test-hint" aria-valuetext={`${Math.round(testSize * 100)} percent`} />
                    <small id="train-test-hint" className="field-hint">Rows held back to score the models fairly. 20% is a good default.</small>
                  </div>
                  <div className="field">
                    <label htmlFor="train-cv">Cross-validation</label>
                    <select id="train-cv" value={cvFolds} onChange={(e) => setCvFolds(Number(e.target.value))} aria-describedby="train-cv-hint">
                      <option value={0}>Off (fastest)</option>
                      {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n} folds{n === 5 ? " (recommended)" : ""}</option>)}
                    </select>
                    <small id="train-cv-hint" className="field-hint">Repeats training on different slices for a more reliable score.</small>
                  </div>
                </>
              )}
            </div>

            <ColumnChecklist
              legend="Features — the columns the model may learn from"
              columns={featureCandidates}
              value={chosenFeatures}
              onChange={setFeatures}
              hint={
                <>
                  All suitable columns are used by default.
                  {excluded.length > 0 && <> Identifier, free-text and empty columns are left out: {excluded.map((c) => c.name).join(", ")}.</>}
                </>
              }
            />

            <fieldset className="algo-picker">
              <legend>Algorithms to compare</legend>
              <div className="check-group-actions">
                <button type="button" className="text-button" onClick={() => setChosenAlgorithms(algorithms[task].map((a) => a.id))}>Select all</button>
                <button type="button" className="text-button" onClick={() => setChosenAlgorithms([])}>Clear</button>
              </div>
              <div className="algo-grid">
                {algorithms[task].map((a) => (
                  <label key={a.id} className={`algo ${chosenAlgorithms.includes(a.id) ? "checked" : ""}`}>
                    <input type="checkbox" checked={chosenAlgorithms.includes(a.id)} onChange={() => toggleAlgorithm(a.id)} />
                    <span>
                      <b>{a.label}</b>
                      <small>{a.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <OperationError error={runner.error} />
            <RunBar canProcess={canProcess} submitting={runner.submitting} busy={busy} purged={version.purged} invalid={invalid} label="Train models" onRun={() => void run()} />
          </div>
        )}
        <RunHistory jobs={jobs} selectedId={selection.selected?.id ?? null} onSelect={selection.select} describe={describe} />
      </section>

      {selection.selected && <RunState job={selection.selected} />}
      {[selection.selected, selection.fallback].map((job) =>
        job?.status === "SUCCEEDED" && job.result ? (
          <section className="panel" key={job.id} aria-label="Training result">
            <ResultHeading job={job} latest={jobs[0] ?? null} note={job === selection.fallback ? "Showing the last successful run." : undefined} />
            <TrainResultView result={job.result as TrainResult} />
            <JobArtifacts job={job} chartsTitle="Evaluation charts" renderFiles={(files) => <TrainDownloads files={files} />} />
          </section>
        ) : null,
      )}
    </>
  );
}

type SortState = { key: string; dir: "asc" | "desc" };

function TrainResultView({ result }: { result: TrainResult }) {
  const primary = result.primaryMetric;
  const metricKeys = useMemo(() => {
    const keys: string[] = [primary];
    for (const row of result.leaderboard ?? []) for (const k of Object.keys(row.metrics ?? {})) if (!keys.includes(k)) keys.push(k);
    return keys;
  }, [result, primary]);
  const hasCv = (result.leaderboard ?? []).some((r) => r.cvScore !== undefined && r.cvScore !== null);
  const [sort, setSort] = useState<SortState>({ key: primary, dir: metricLowerIsBetter(primary) ? "asc" : "desc" });

  const rows = useMemo(() => {
    const value = (row: LeaderboardRow): number | string | null => {
      if (sort.key === "algorithm") return row.label;
      if (sort.key === "cvScore") return row.cvScore ?? null;
      if (sort.key === "fitSeconds") return row.fitSeconds;
      return row.metrics?.[sort.key] ?? null;
    };
    return [...(result.leaderboard ?? [])].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb)) : va - vb;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [result, sort]);

  function sortBy(key: string): void {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: metricLowerIsBetter(key) || key === "algorithm" || key === "fitSeconds" ? "asc" : "desc" }));
  }

  const header = (key: string, label: string, numeric = true) => (
    <th scope="col" className={numeric ? "num" : undefined} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sort-button" onClick={() => sortBy(key)}>
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : " ↕"}</span>
      </button>
    </th>
  );

  const bestValue = result.best?.metrics?.[primary];
  const importance = result.featureImportance ?? [];
  const maxImportance = Math.max(...importance.map((f) => Math.abs(f.importance)), 0);
  const findings = result.findings ?? [];

  return (
    <div className="result-body">
      <div className="best-model">
        <div>
          <div className="eyebrow">BEST MODEL</div>
          <h3>{result.best?.label ?? "—"}</h3>
          <p className="muted small">
            {result.task}{result.target ? <> · predicting <code>{result.target}</code></> : null} · {formatNumber(result.features?.length)} features · {formatNumber(result.rows?.train)} training rows{result.rows?.test ? ` · ${formatNumber(result.rows.test)} test rows` : ""}
          </p>
        </div>
        <div className="best-metric">
          <span className="eyebrow">{metricLabel(primary).toUpperCase()}</span>
          <b>{formatCell(bestValue ?? null)}</b>
        </div>
      </div>
      {metricExplanation(primary) && (
        <p className="muted small"><b>How models are ranked:</b> {metricLabel(primary)} — {metricExplanation(primary)}</p>
      )}

      {findings.length > 0 && (
        <>
          <h3 className="subhead">Findings &amp; warnings</h3>
          <ul className="findings">
            {findings.map((finding, index) => (
              <li key={`${finding.type}-${index}`} className={`finding finding-${finding.severity}`}>
                <div className="finding-head">
                  <SeverityBadge severity={finding.severity} />
                  <b>{finding.type.replace(/_/g, " ")}</b>
                  {finding.column && <code>{finding.column}</code>}
                </div>
                <p>{finding.evidence}</p>
                {finding.recommendation && <p className="muted small">→ {finding.recommendation}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="subhead">Leaderboard</h3>
      <div className="table-wrap">
        <table className="data-table leaderboard">
          <caption className="visually-hidden">Algorithms ranked by {metricLabel(primary)}. Select a column header to sort.</caption>
          <thead>
            <tr>
              {header("algorithm", "Algorithm", false)}
              {metricKeys.map((k) => <th key={k} scope="col" className="num" aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="sort-button" onClick={() => sortBy(k)} title={metricExplanation(k) ?? undefined}>
                  {metricLabel(k)}{k === primary ? " ★" : ""}
                  <span aria-hidden="true">{sort.key === k ? (sort.dir === "asc" ? " ▲" : " ▼") : " ↕"}</span>
                </button>
              </th>)}
              {hasCv && header("cvScore", "CV score")}
              {header("fitSeconds", "Fit time")}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const best = row.algorithm === result.best?.algorithm;
              return (
                <tr key={row.algorithm} className={best ? "best-row" : undefined}>
                  <th scope="row">{row.label || algorithmLabel(result.task, row.algorithm)} {best && <span className="badge badge-good">best</span>}</th>
                  {metricKeys.map((k) => <td key={k} className="num">{formatCell(row.metrics?.[k] ?? null)}</td>)}
                  {hasCv && <td className="num">{formatCell(row.cvScore ?? null)}</td>}
                  <td className="num">{formatNumber(row.fitSeconds, 2)}s</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">★ marks the ranking metric. Scores are measured on rows the models never saw during training.</p>

      {importance.length > 0 && (
        <>
          <h3 className="subhead">What drives the best model</h3>
          <ul className="bar-list">
            {importance.map((f) => (
              <li key={f.feature}>
                <code>{f.feature}</code>
                <ShareBar value={maxImportance > 0 ? Math.abs(f.importance) / maxImportance : 0} label={`Importance ${formatCell(f.importance)}`} />
                <span className="mono-small">{formatCell(f.importance)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Permutation importance: how much the score drops when a column is shuffled. It shows what the model relies on, not cause and effect.</p>
        </>
      )}

      {result.clusters && result.clusters.length > 0 && (
        <>
          <h3 className="subhead">Cluster sizes</h3>
          <ul className="bar-list">
            {(() => {
              const total = result.clusters.reduce((sum, c) => sum + c.size, 0) || 1;
              return result.clusters.map((c) => (
                <li key={String(c.cluster)}>
                  <code>Cluster {String(c.cluster)}</code>
                  <ShareBar value={c.size / total} label={`${formatNumber((c.size / total) * 100, 1)}% of rows`} />
                  <span className="mono-small">{formatNumber(c.size)} rows</span>
                </li>
              ));
            })()}
          </ul>
        </>
      )}
    </div>
  );
}

const downloadOrder: Array<{ kinds: ArtifactKind[]; description: string }> = [
  { kinds: ["MODEL"], description: "The trained pipeline (scikit-learn .joblib) — load it in Python to make predictions." },
  { kinds: ["DATA", "TABLE"], description: "Test-set predictions next to the actual values, and other result tables." },
  { kinds: ["CODE"], description: "A Python script that reproduces this training run." },
  { kinds: ["REPORT"], description: "Model card: data, metrics, limitations and intended use." },
];

function TrainDownloads({ files }: { files: Artifact[] }) {
  const ordered = downloadOrder.flatMap((group) => files.filter((f) => group.kinds.includes(f.kind)).map((f) => ({ artifact: f, description: group.description })));
  const rest = files.filter((f) => !ordered.some((o) => o.artifact.id === f.id));
  return (
    <div className="train-downloads">
      <h3 className="subhead">Downloads</h3>
      <ul className="file-cards">
        {ordered.map(({ artifact, description }) => (
          <FileCard key={artifact.id} artifact={artifact} emphasis={artifact.kind === "MODEL"} description={description} />
        ))}
        {rest.map((artifact) => <FileCard key={artifact.id} artifact={artifact} />)}
      </ul>
      <Notice tone="warn" title="Only load model files from sources you trust">
        A .joblib file can run code when it is loaded. Load models you trained here or received from someone you trust, with the same scikit-learn version shown in the model card.
      </Notice>
    </div>
  );
}

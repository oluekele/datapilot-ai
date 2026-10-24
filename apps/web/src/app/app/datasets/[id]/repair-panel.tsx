"use client";

import { useState } from "react";
import { RiskBadge } from "@/components/status-badges";
import { Button, EmptyState, ErrorNotice } from "@/components/ui";
import { apiPost } from "@/lib/api";
import type { Job, RepairPlanItem, Version } from "@/lib/types";

type Props = {
  datasetId: string;
  version: Version;
  plan: RepairPlanItem[];
  canProcess: boolean;
  busy: boolean;
  onCreated: () => Promise<void>;
};

export function RepairPanel({ datasetId, version, plan, canProcess, busy, onCreated }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [methods, setMethods] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      plan
        .filter((item) => item.methods && Object.keys(item.methods).length > 0)
        .map((item) => [item.id, item.default_method ?? Object.keys(item.methods ?? {})[0]]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    const actions = plan.filter((item) => selected.has(item.id)).map((item) => item.id);
    const chosenMethods = Object.fromEntries(Object.entries(methods).filter(([id]) => selected.has(id)));
    try {
      await apiPost<Job>(`/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(version.id)}/repairs`, {
        actions,
        ...(Object.keys(chosenMethods).length > 0 ? { methods: chosenMethods } : {}),
      });
      setSelected(new Set());
      await onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="repair-heading">
      <div className="panel-head">
        <div>
          <div className="eyebrow">REVIEW BEFORE ANYTHING CHANGES</div>
          <h2 id="repair-heading">Repair recommendations</h2>
        </div>
        {plan.length > 0 && (
          <div className="button-row">
            <button type="button" className="text-button" onClick={() => setSelected(new Set(plan.map((p) => p.id)))}>Select all</button>
            <button type="button" className="text-button" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {plan.length === 0 ? (
        <EmptyState icon="✓" title="No repairs recommended">This version looks clean — there is nothing DataPilot would change.</EmptyState>
      ) : (
        <>
          <p className="muted small">Nothing changes until you choose. Selected repairs create a new REPAIRED version from v{version.versionNumber}; this version is kept exactly as it is.</p>
          <ul className="repair-list">
            {plan.map((item) => {
              const checked = selected.has(item.id);
              const methodEntries = Object.entries(item.methods ?? {});
              const inputId = `repair-${item.id}`;
              return (
                <li key={item.id} className={`repair-item ${checked ? "checked" : ""}`}>
                  <div className="repair-check">
                    <input id={inputId} type="checkbox" checked={checked} onChange={() => toggle(item.id)} />
                  </div>
                  <div className="repair-body">
                    <label htmlFor={inputId} className="repair-title">
                      <b>{item.title}</b>
                      <RiskBadge risk={item.risk} />
                      {item.column && <code>{item.column}</code>}
                    </label>
                    <p><span className="eyebrow">EVIDENCE</span> {item.evidence}</p>
                    <p><span className="eyebrow">RECOMMENDATION</span> {item.recommendation}</p>
                    {item.note && <p className="repair-note">ⓘ {item.note}</p>}
                    {methodEntries.length > 0 && (
                      <label className="method-select">
                        <span>Method</span>
                        <select
                          value={methods[item.id] ?? ""}
                          onChange={(event) => setMethods((m) => ({ ...m, [item.id]: event.target.value }))}
                        >
                          {methodEntries.map(([value, label]) => (
                            <option key={value} value={value}>{label}{value === item.default_method ? " (recommended)" : ""}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <ErrorNotice error={error} />
          <div className="repair-submit">
            <span className="muted small">{selected.size} of {plan.length} selected</span>
            <Button
              loading={submitting}
              disabled={selected.size === 0 || !canProcess || busy || version.purged}
              title={!canProcess ? "An active subscription is required to process data" : undefined}
              onClick={() => void submit()}
            >
              Create repaired version <span aria-hidden="true">→</span>
            </Button>
          </div>
          {!canProcess && <p className="muted small">Processing requires an active subscription or trial.</p>}
        </>
      )}
    </section>
  );
}

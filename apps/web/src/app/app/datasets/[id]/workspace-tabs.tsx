"use client";

import { useRef, type KeyboardEvent } from "react";

export type WorkspaceTab = "overview" | "clean" | "explore" | "analyse" | "visualise" | "train" | "outputs";

export const workspaceTabs: Array<{ id: WorkspaceTab; label: string; hint: string }> = [
  { id: "overview", label: "Overview", hint: "Health report" },
  { id: "clean", label: "Clean", hint: "Repairs" },
  { id: "explore", label: "Explore", hint: "EDA" },
  { id: "analyse", label: "Analyse", hint: "Statistical tests" },
  { id: "visualise", label: "Visualise", hint: "Chart builder" },
  { id: "train", label: "Train", hint: "Machine learning" },
  { id: "outputs", label: "Outputs", hint: "Downloads" },
];

export function parseTab(value: string | null): WorkspaceTab {
  return workspaceTabs.some((t) => t.id === value) ? (value as WorkspaceTab) : "overview";
}

export const tabId = (tab: WorkspaceTab) => `ws-tab-${tab}`;
export const panelId = (tab: WorkspaceTab) => `ws-panel-${tab}`;

type Props = {
  active: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  /** Tabs with a job currently queued or running. */
  busy: Partial<Record<WorkspaceTab, boolean>>;
};

/** WAI-ARIA tabs with roving focus: ←/→ move, Home/End jump. */
export function WorkspaceTabs({ active, onChange, busy }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % workspaceTabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + workspaceTabs.length) % workspaceTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = workspaceTabs.length - 1;
    else return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(workspaceTabs[next].id);
  }

  return (
    <div className="ws-tabs" role="tablist" aria-label="Dataset workflow">
      {workspaceTabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[index] = el; }}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            className={`ws-tab ${selected ? "active" : ""}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <span className="ws-tab-step" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="ws-tab-text">
              <b>{tab.label}{busy[tab.id] && <i className="pulse-dot" aria-label="running" />}</b>
              <small>{tab.hint}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type TourStep = { eyebrow: string; title: string; body: ReactNode; icon: string };

type TourDialogProps = {
  steps: TourStep[];
  open: boolean;
  /** "finish" when the last step is completed, "skip" when dismissed early. */
  onDone: (how: "finish" | "skip") => void;
  label?: string;
  finishLabel?: string;
  busy?: boolean;
};

/** Multi-step walkthrough on a native <dialog>: focus trap, Escape, arrow-key navigation. */
export function TourDialog({ steps, open, onDone, label = "DATAPILOT GUIDE", finishLabel = "Finish tour", busy = false }: TourDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex === steps.length - 1;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setStepIndex(0);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function advance(): void {
    if (isLast) onDone("finish");
    else setStepIndex((current) => current + 1);
  }

  function back(): void {
    setStepIndex((current) => Math.max(0, current - 1));
  }

  return (
    <dialog
      className="tour-dialog"
      ref={dialogRef}
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDone("skip");
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "BUTTON" && (event.key === "Enter" || event.key === " ")) return;
        if (event.key === "ArrowRight") advance();
        if (event.key === "ArrowLeft") back();
      }}
    >
      <div className="tour-top">
        <span className="tour-brand"><span className="brand-mark">D</span> {label}</span>
        <button className="tour-close" type="button" onClick={() => onDone("skip")} disabled={busy} aria-label="Close guide">×</button>
      </div>
      <div className="tour-content" aria-live="polite">
        <div className="tour-icon" aria-hidden="true">{step.icon}</div>
        <div className="eyebrow">{step.eyebrow}</div>
        <h2 id="tour-title">{step.title}</h2>
        <div id="tour-body" className="tour-body">{step.body}</div>
      </div>
      <div className="tour-progress" role="tablist" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
        {steps.map((item, index) => (
          <button
            key={item.eyebrow}
            type="button"
            role="tab"
            aria-selected={index === stepIndex}
            aria-label={`Go to step ${index + 1}: ${item.title}`}
            className={index <= stepIndex ? "active" : ""}
            onClick={() => setStepIndex(index)}
          />
        ))}
      </div>
      <div className="tour-bottom">
        <span>{String(stepIndex + 1).padStart(2, "0")} <i>/</i> {String(steps.length).padStart(2, "0")}</span>
        <div>
          {!isLast && <button className="text-button" type="button" onClick={() => onDone("skip")} disabled={busy}>Skip</button>}
          {stepIndex > 0 && <button className="text-button" type="button" onClick={back}>Back</button>}
          <button className="button button-dark" type="button" onClick={advance} disabled={busy} autoFocus>
            {isLast ? finishLabel : "Continue"}<span aria-hidden="true"> →</span>
          </button>
        </div>
      </div>
    </dialog>
  );
}

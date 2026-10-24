"use client";

import { useEffect, useState } from "react";
import { TourDialog, type TourStep } from "@/components/tour-dialog";

// Landing-page product tour. The "seen" flag is a pure UI preference.
const STORAGE_KEY = "datapilot:onboarding:v1";
const steps: TourStep[] = [
  { eyebrow: "WELCOME TO DATAPILOT", title: "Your data journey, made clear.", body: <p>This short guide walks through the stages of a DataPilot workspace. You can reopen it from Product tour whenever you need a reminder.</p>, icon: "✳" },
  { eyebrow: "01 · UPLOAD", title: "Start with a dataset.", body: <p>Upload a CSV or Excel file to begin. Files belong to your organisation and are visible only to people you authorise.</p>, icon: "↥" },
  { eyebrow: "02 · UNDERSTAND", title: "See the shape and the signals.", body: <p>Review column types, missing values, duplicates, unusual values, and a health score before drawing conclusions.</p>, icon: "⌕" },
  { eyebrow: "03 · REPAIR", title: "Choose what changes—if any.", body: <p>Every proposed repair is reviewable. Applying one creates a new version; the raw upload remains preserved for comparison and recovery.</p>, icon: "◇" },
  { eyebrow: "04 · HISTORY & EXPORT", title: "Keep the work reproducible.", body: <p>Every job is saved with its settings. Download raw and repaired files or a report for your team.</p>, icon: "↗" },
];

function readFlag(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "complete";
  } catch {
    return true;
  }
}

function writeFlag(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "complete");
  } catch {
    /* storage unavailable — the tour simply shows again next time */
  }
}

export function OnboardingGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!readFlag()) setOpen(true);
    const openGuide = () => setOpen(true);
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-open-guide]")) openGuide();
    };
    document.addEventListener("datapilot:open-guide", openGuide);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("datapilot:open-guide", openGuide);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <TourDialog
      steps={steps}
      open={open}
      onDone={() => {
        writeFlag();
        setOpen(false);
      }}
    />
  );
}

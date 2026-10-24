import type { TourStep } from "@/components/tour-dialog";

/** The in-app walkthrough shown to every new user (and from the Guide button). */
export const workspaceSteps: TourStep[] = [
  {
    eyebrow: "01 · WELCOME",
    title: "Welcome to your workspace.",
    icon: "✳",
    body: (
      <>
        <p>Everything in DataPilot happens inside an organisation workspace. An <b>individual</b> account is a private workspace just for you; an <b>organisation</b> account lets a team share datasets and history.</p>
        <p>Your data is private to your organisation — no other customer can see it. Switch workspaces any time from the top bar.</p>
      </>
    ),
  },
  {
    eyebrow: "02 · UPLOAD",
    title: "Upload your raw data.",
    icon: "↥",
    body: (
      <>
        <p>Drop in a <b>CSV or XLSX</b> file. DataPilot stores the original exactly as uploaded as an immutable <b>RAW</b> version.</p>
        <p>Nothing you do later can alter that file, so you can always go back to the source.</p>
      </>
    ),
  },
  {
    eyebrow: "03 · PROFILE",
    title: "Automatic profiling & health score.",
    icon: "⌕",
    body: (
      <>
        <p>Every upload is profiled automatically: missing values, duplicates, data types, constant columns and outliers.</p>
        <p>You get a <b>health score</b> out of 100, a list of findings with severity, and statistics for every column.</p>
      </>
    ),
  },
  {
    eyebrow: "04 · REVIEW",
    title: "Review repair recommendations.",
    icon: "◇",
    body: (
      <>
        <p>In the <b>Clean</b> step DataPilot proposes repairs with the evidence behind each one. <b>Nothing changes until you choose.</b></p>
        <p>Each recommendation shows a risk level, and where there is more than one sensible approach — like filling with a median or a mode — you pick the method.</p>
      </>
    ),
  },
  {
    eyebrow: "05 · COMPARE",
    title: "Repaired versions, side by side.",
    icon: "⇄",
    body: (
      <>
        <p>Applying repairs creates a new <b>REPAIRED</b> version linked to its parent. You see before/after metrics — rows, missing cells, duplicates — and exactly what each repair changed.</p>
        <p>The raw version is always kept.</p>
      </>
    ),
  },
  {
    eyebrow: "06 · EXPLORE & ANALYSE",
    title: "Explore, then test your ideas.",
    icon: "⌕",
    body: (
      <>
        <p>Each dataset is a step-by-step workspace: <b>Overview → Clean → Explore → Analyse → Visualise → Train → Outputs</b>. Every step runs on the version you pick in the timeline.</p>
        <p><b>Explore</b> gives a guided first look — distributions, missing values, top categories and correlations. <b>Analyse</b> runs statistical tests (compare groups, chi-square, correlation) and explains the answer in plain language.</p>
      </>
    ),
  },
  {
    eyebrow: "07 · VISUALISE & TRAIN",
    title: "Charts and machine learning.",
    icon: "◩",
    body: (
      <>
        <p><b>Visualise</b> is a chart builder: design up to 12 charts and render them as PNG or SVG in one go.</p>
        <p><b>Train</b> compares several machine-learning algorithms on the same data and ranks them, then lets you download the best model, its predictions, a reproducible training script and a model card.</p>
      </>
    ),
  },
  {
    eyebrow: "08 · LIBRARY & HISTORY",
    title: "Every output in one Library.",
    icon: "▣",
    body: (
      <>
        <p>Charts, tables, models, reports and code from every run are collected in the <b>Library</b> — filter, preview, and download one file or a whole selection as a ZIP.</p>
        <p><b>History</b> records every job with who ran it and when, and you can still download the raw file, any repaired version or a Markdown quality report.</p>
      </>
    ),
  },
  {
    eyebrow: "09 · TEAM & BILLING",
    title: "Team & billing.",
    icon: "◎",
    body: (
      <>
        <p>Invite colleagues to an organisation workspace from <b>Team</b>. After your free trial, uploading and processing need an active subscription — your existing data always stays viewable and downloadable.</p>
        <p>New accounts start with a free trial — one per person and per business. When it ends, pick a plan in <b>Billing</b> to keep uploading and processing.</p>
      </>
    ),
  },
];

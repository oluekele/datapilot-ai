"use client";

import { useState, type ReactNode } from "react";
import { LoadingBlock } from "@/components/page-header";
import { ErrorNotice } from "@/components/ui";
import { useResource } from "@/components/use-resource";
import { artifactArchiveUrl, artifactsPath } from "@/lib/api";
import type { Artifact, ArtifactPage, Job } from "@/lib/types";
import { ArtifactLightbox, ChartThumb, FileCard } from "./artifact-parts";

type Props = {
  job: Job;
  /** Heading above the chart gallery. */
  chartsTitle?: string;
  /** Show the non-chart files (tables, models, code…). */
  showFiles?: boolean;
  /** Custom renderer for the non-chart files (e.g. Train's prominent downloads). */
  renderFiles?: (files: Artifact[]) => ReactNode;
};

/** Outputs produced by one successful job: a chart gallery plus downloadable files. */
export function JobArtifacts({ job, chartsTitle = "Charts", showFiles = true, renderFiles }: Props) {
  const page = useResource<ArtifactPage>(job.status === "SUCCEEDED" ? artifactsPath({ jobId: job.id }, { limit: 100 }) : null);
  const [open, setOpen] = useState<Artifact | null>(null);

  if (job.status !== "SUCCEEDED") return null;
  if (page.loading && !page.data) return <LoadingBlock label="Loading outputs…" />;
  if (page.error) return <ErrorNotice error={page.error} title="Couldn't load this run's outputs" />;
  const items = page.data?.items ?? [];
  if (items.length === 0) return null;

  const charts = items.filter((a) => a.kind === "CHART");
  const files = items.filter((a) => a.kind !== "CHART");

  return (
    <div className="job-artifacts">
      {charts.length > 0 && (
        <>
          <div className="subhead-row">
            <h3 className="subhead">{chartsTitle} <span className="muted small">({charts.length})</span></h3>
            <a className="button button-light button-small" href={artifactArchiveUrl({ jobId: job.id, kind: "CHART" })} download>↓ Download all charts (.zip)</a>
          </div>
          <ul className="chart-grid">
            {charts.map((artifact) => <ChartThumb key={artifact.id} artifact={artifact} onOpen={setOpen} />)}
          </ul>
        </>
      )}
      {showFiles && files.length > 0 && (
        renderFiles ? renderFiles(files) : (
          <>
            <h3 className="subhead">Files from this run</h3>
            <ul className="file-cards">
              {files.map((artifact) => <FileCard key={artifact.id} artifact={artifact} />)}
            </ul>
          </>
        )
      )}
      <ArtifactLightbox artifact={open} onClose={() => setOpen(null)} />
    </div>
  );
}

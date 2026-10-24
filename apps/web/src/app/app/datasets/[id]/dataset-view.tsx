"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ArtifactLibrary } from "@/components/library/artifact-library";
import { useMe } from "@/components/me-provider";
import { LoadingBlock } from "@/components/page-header";
import { JobStatusBadge, VersionKindBadge } from "@/components/status-badges";
import { Button, EmptyState, ErrorNotice, Modal, Notice } from "@/components/ui";
import { usePolling, useResource } from "@/components/use-resource";
import { apiDelete, apiPost } from "@/lib/api";
import { formatBytes, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import type { DatasetDetail, Job, JobType, OperationType, ProfileResult, RepairResult, Version } from "@/lib/types";
import { AnalyseTab } from "./operations/analyse-tab";
import { ExploreTab } from "./operations/explore-tab";
import { columnsFromProfile, type OperationTabProps } from "./operations/shared";
import { TrainTab } from "./operations/train-tab";
import { VisualiseTab } from "./operations/visualise-tab";
import { ProfileView } from "./profile-view";
import { RepairComparison } from "./repair-comparison";
import { RepairPanel } from "./repair-panel";
import { VersionTimeline } from "./version-timeline";
import { panelId, parseTab, tabId, type WorkspaceTab, WorkspaceTabs } from "./workspace-tabs";

const operationTabs: Record<OperationType, WorkspaceTab> = { EXPLORE: "explore", ANALYZE: "analyse", VISUALIZE: "visualise", TRAIN: "train" };

const isActive = (job: Job) => job.status === "QUEUED" || job.status === "RUNNING";

export function DatasetView({ datasetId }: { datasetId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const { me, refresh: refreshMe } = useMe();
  const dataset = useResource<DatasetDetail>(`/datasets/${encodeURIComponent(datasetId)}`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [profiling, setProfiling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const data = dataset.data;
  const hasActiveJobs = !!data?.jobs.some(isActive);
  usePolling(hasActiveJobs, async () => {
    await dataset.reload();
  }, 2000);

  const version = useMemo(() => {
    if (!data || data.versions.length === 0) return null;
    return data.versions.find((v) => v.id === selectedId) ?? data.versions[0];
  }, [data, selectedId]);

  const versionJobs = useMemo(() => (data && version ? data.jobs.filter((job) => job.datasetVersionId === version.id) : []), [data, version]);
  const latestProfile = versionJobs.find((job) => job.type === "PROFILE") ?? null;
  const latestSucceededProfile = versionJobs.find((job) => job.type === "PROFILE" && job.status === "SUCCEEDED" && job.result) ?? null;
  const latestRepairFromHere = versionJobs.find((job) => job.type === "REPAIR") ?? null;
  const producingRepair = data && version ? data.jobs.find((job) => job.type === "REPAIR" && job.outputVersionId === version.id) ?? null : null;
  const canProcess = !!me?.entitlement?.active;
  const profileResult = latestSucceededProfile ? (latestSucceededProfile.result as ProfileResult) : null;
  const columns = useMemo(() => (profileResult ? columnsFromProfile(profileResult) : null), [profileResult]);

  const reloadDataset = dataset.reload;
  const onCreated = useCallback(async () => {
    await reloadDataset();
    void refreshMe();
  }, [reloadDataset, refreshMe]);

  function selectTab(next: WorkspaceTab): void {
    const query = new URLSearchParams(searchParams.toString());
    if (next === "overview") query.delete("tab");
    else query.set("tab", next);
    const qs = query.toString();
    // Shallow URL update: Next.js syncs useSearchParams with the History API, so no server round trip.
    window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
  }

  if (dataset.loading && !data) return <LoadingBlock label="Loading dataset…" />;
  if (!data) {
    return (
      <>
        <ErrorNotice error={dataset.error} title="Couldn't load this dataset" />
        <Link className="button button-light button-small" href="/app">← Back to datasets</Link>
      </>
    );
  }

  async function rerunProfile(): Promise<void> {
    if (!version) return;
    setProfiling(true);
    setActionError(null);
    try {
      await apiPost<Job>(`/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(version.id)}/profile`);
      await dataset.reload();
      void refreshMe();
    } catch (err) {
      setActionError(err);
    } finally {
      setProfiling(false);
    }
  }

  async function remove(): Promise<void> {
    setDeleting(true);
    setActionError(null);
    try {
      await apiDelete(`/datasets/${encodeURIComponent(datasetId)}`);
      void refreshMe();
      router.push("/app");
    } catch (err) {
      setActionError(err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const profileGate: ReactNode = !latestProfile ? (
    <Notice
      tone="info"
      title="Profile this version first"
      action={<Button size="small" loading={profiling} disabled={!canProcess || !version || version.purged} onClick={() => void rerunProfile()}>Run profile</Button>}
    >
      Column pickers use the column types found by profiling. Profiling takes a few seconds.
    </Notice>
  ) : isActive(latestProfile) ? (
    <Notice tone="info" title="Profiling in progress">The options appear here as soon as the profile finishes.</Notice>
  ) : (
    <Notice
      tone="warn"
      title="No successful profile for this version"
      action={<Button size="small" loading={profiling} disabled={!canProcess || !version || version.purged} onClick={() => void rerunProfile()}>Re-run profile</Button>}
    >
      {latestProfile.errorMessage ?? "The last profile did not finish."} Column types are needed before running this operation.
    </Notice>
  );

  const busyTabs: Partial<Record<WorkspaceTab, boolean>> = {};
  for (const job of versionJobs) {
    if (!isActive(job)) continue;
    if (job.type === "PROFILE") busyTabs.overview = true;
    else if (job.type === "REPAIR") busyTabs.clean = true;
    else busyTabs[operationTabs[job.type]] = true;
  }

  function opProps(operation: OperationType, current: Version): OperationTabProps {
    return {
      datasetId,
      version: current,
      jobs: versionJobs.filter((job) => job.type === (operation as JobType)),
      columns,
      canProcess,
      onCreated,
      profileGate,
    };
  }

  const overview = version && (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">VERSION {version.versionNumber} · {version.kind}</div>
            <h2>Health report</h2>
          </div>
          <div className="button-row">
            {latestProfile && <JobStatusBadge status={latestProfile.status} />}
            <Button
              variant="light"
              size="small"
              loading={profiling}
              disabled={!canProcess || version.purged || (latestProfile ? isActive(latestProfile) : false)}
              title={!canProcess ? "An active subscription is required to process data" : undefined}
              onClick={() => void rerunProfile()}
            >
              Re-run profile
            </Button>
          </div>
        </div>

        {!latestProfile && <EmptyState title="Not profiled yet" icon="⌕">Run a profile to see this version&apos;s health report.</EmptyState>}
        {latestProfile && isActive(latestProfile) && (
          <Notice tone="info" title={latestProfile.status === "QUEUED" ? "Profile queued" : "Profiling in progress"}>
            Started {formatRelative(latestProfile.createdAt)}. This page updates automatically.
          </Notice>
        )}
        {latestProfile?.status === "FAILED" && (
          <Notice tone="bad" title="Profiling failed">{latestProfile.errorMessage ?? "The profiling job failed."}</Notice>
        )}
        {latestSucceededProfile && (
          <>
            {latestSucceededProfile !== latestProfile && <p className="muted small">Showing the last successful profile from {formatDateTime(latestSucceededProfile.finishedAt)}.</p>}
            <ProfileView result={latestSucceededProfile.result as ProfileResult} />
          </>
        )}
      </div>

      {producingRepair?.status === "SUCCEEDED" && producingRepair.result && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">HOW THIS VERSION WAS MADE</div>
              <h2>Before &amp; after</h2>
            </div>
          </div>
          <RepairComparison result={producingRepair.result as RepairResult} />
        </div>
      )}
    </>
  );

  const clean = version && (
    <>
      {!latestSucceededProfile && <div className="clean-gate">{profileGate}</div>}
      {latestRepairFromHere && (
        <RepairStatus job={latestRepairFromHere} onOpenVersion={setSelectedId} />
      )}

      {latestSucceededProfile && (
        <RepairPanel
          key={`${version.id}-${latestSucceededProfile.id}`}
          datasetId={data.id}
          version={version}
          plan={(latestSucceededProfile.result as ProfileResult).repairPlan ?? []}
          canProcess={canProcess}
          busy={latestRepairFromHere ? isActive(latestRepairFromHere) : false}
          onCreated={onCreated}
        />
      )}
    </>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <Link className="eyebrow back-link" href="/app">← DATASETS</Link>
          <h1 className="dataset-title">{data.name}</h1>
          <p className="page-lede">Created {formatDateTime(data.createdAt)} by {data.createdBy?.displayName ?? "—"} · {data.versions.length} {data.versions.length === 1 ? "version" : "versions"}</p>
        </div>
        <div className="page-actions">
          <Button variant="danger" size="small" onClick={() => setConfirmDelete(true)}>Delete dataset</Button>
        </div>
      </div>

      <ErrorNotice error={actionError} />

      {data.versions.length === 0 ? (
        <EmptyState title="No versions" icon="◫">This dataset has no stored versions.</EmptyState>
      ) : (
        <div className="dataset-layout">
          <VersionTimeline datasetId={data.id} versions={data.versions} jobs={data.jobs} selectedId={version?.id ?? null} onSelect={setSelectedId} />

          {version && (
            <div className="dataset-detail">
              <div className="version-bar">
                <div>
                  <div className="eyebrow">WORKING ON</div>
                  <div className="version-bar-title">
                    <b>Version {version.versionNumber}</b>
                    <VersionKindBadge kind={version.kind} />
                    <span className="muted small">{version.originalFilename}</span>
                  </div>
                  <span className="mono-small">{formatNumber(version.rowCount)} rows × {formatNumber(version.columnCount)} cols · {formatBytes(version.fileSizeBytes)}</span>
                </div>
                <p className="muted small">Every operation runs on this version. Pick another in the timeline to switch.</p>
              </div>

              <WorkspaceTabs active={tab} onChange={selectTab} busy={busyTabs} />

              <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} tabIndex={0} className="ws-panel">
                {tab === "overview" && overview}
                {tab === "clean" && clean}
                {tab === "explore" && <ExploreTab key={version.id} {...opProps("EXPLORE", version)} />}
                {tab === "analyse" && <AnalyseTab key={version.id} {...opProps("ANALYZE", version)} />}
                {tab === "visualise" && <VisualiseTab key={version.id} {...opProps("VISUALIZE", version)} />}
                {tab === "train" && <TrainTab key={version.id} {...opProps("TRAIN", version)} />}
                {tab === "outputs" && (
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <div className="eyebrow">OUTPUTS FOR THIS DATASET · ALL VERSIONS</div>
                        <h2>Outputs</h2>
                      </div>
                      <Link className="button button-light button-small" href="/app/library">Open Library →</Link>
                    </div>
                    <ArtifactLibrary datasetId={data.id} />
                  </section>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal
        open={confirmDelete}
        title="Delete this dataset?"
        eyebrow="PERMANENT ACTION"
        onClose={() => setConfirmDelete(false)}
        locked={deleting}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>Delete dataset</Button>
          </>
        }
      >
        <p>All stored files for <b>{data.name}</b> — the raw upload and every repaired version — will be deleted. Job history is kept for audit purposes.</p>
        <p className="muted small">Download anything you need first. This cannot be undone.</p>
      </Modal>
    </>
  );
}

function RepairStatus({ job, onOpenVersion }: { job: Job; onOpenVersion: (id: string) => void }) {
  if (job.status === "SUCCEEDED") {
    return (
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">LATEST REPAIR FROM THIS VERSION</div>
            <h2>Repaired version created</h2>
          </div>
          {job.outputVersionId && (
            <Button size="small" onClick={() => onOpenVersion(job.outputVersionId as string)}>Open new version →</Button>
          )}
        </div>
        {job.result && <RepairComparison result={job.result as RepairResult} />}
      </div>
    );
  }
  if (job.status === "FAILED") {
    return <Notice tone="bad" title="The last repair failed">{job.errorMessage ?? "The repair job failed."} The original version is unchanged.</Notice>;
  }
  if (job.status === "CANCELED") return null;
  return (
    <Notice tone="info" title={job.status === "QUEUED" ? "Repair queued" : "Applying repairs…"}>
      A new repaired version will appear in the timeline when it finishes. This page updates automatically.
    </Notice>
  );
}

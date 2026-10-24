import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type { DatasetVersion, Dataset, Prisma, ProcessingJob } from "@prisma/client";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditService } from "../common/audit.service";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";
import { PrismaService } from "../database/prisma.service";
import { CONTENT_TYPES } from "../datasets/datasets.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { StorageService } from "../storage/storage.service";
import { CollectedArtifact, collectArtifacts } from "./artifact-manifest";
import { runPythonWorker } from "./python-worker";

const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MS = 15 * 60 * 1000;

type ClaimedJob = ProcessingJob & { datasetVersion: DatasetVersion; dataset: Dataset };

/**
 * A small Postgres-backed queue: jobs are claimed with FOR UPDATE SKIP LOCKED,
 * so several API instances can run workers without double-processing. Replace
 * with a dedicated queue (e.g. BullMQ) if throughput demands it.
 */
@Injectable()
export class JobRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = 0;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.worker.enabled) return;
    await this.recoverStale();
    this.timer = setInterval(() => {
      // A database outage must not crash the API; try again on the next poll.
      this.tick().catch((error: Error) => {
        this.logger.warn(`Job polling failed: ${error.message.split("\n").pop()}`);
      });
    }, this.config.worker.pollMs);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Jobs left RUNNING by a crashed process are retried or failed. */
  private async recoverStale(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
    await this.prisma.processingJob.updateMany({
      where: { status: "RUNNING", startedAt: { lt: cutoff }, attempts: { lt: MAX_ATTEMPTS } },
      data: { status: "QUEUED" },
    });
    await this.prisma.processingJob.updateMany({
      where: { status: "RUNNING", startedAt: { lt: cutoff } },
      data: { status: "FAILED", errorMessage: "Processing was interrupted.", finishedAt: new Date() },
    });
  }

  async tick(): Promise<void> {
    while (!this.stopping && this.running < this.config.worker.concurrency) {
      const job = await this.claim();
      if (!job) return;
      this.running += 1;
      void this.process(job)
        .catch((error: Error) => this.logger.error(`Job ${job.id} could not be finalised: ${error.message}`))
        .finally(() => {
          this.running -= 1;
        });
    }
  }

  private async claim(): Promise<ClaimedJob | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "ProcessingJob" SET status = 'RUNNING', "startedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
      WHERE id = (
        SELECT id FROM "ProcessingJob" WHERE status = 'QUEUED'
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING id`;
    if (!rows.length) return null;
    return this.prisma.processingJob.findUniqueOrThrow({
      where: { id: rows[0].id },
      include: { datasetVersion: true, dataset: true },
    });
  }

  private async finish(job: ProcessingJob, data: Prisma.ProcessingJobUpdateInput): Promise<void> {
    await this.prisma.processingJob.update({ where: { id: job.id }, data: { ...data, finishedAt: new Date() } });
  }

  async process(job: ClaimedJob): Promise<void> {
    const version = job.datasetVersion;
    if (!version.objectKey || job.dataset.deletedAt) {
      await this.finish(job, { status: "CANCELED", errorMessage: "The dataset was deleted." });
      return;
    }
    const workdir = await mkdtemp(join(tmpdir(), "datapilot-job-"));
    try {
      const inputPath = join(workdir, `input${version.originalFilename.toLowerCase().endsWith(".xlsx") ? ".xlsx" : ".csv"}`);
      const outputPath = join(workdir, "output.csv");
      const outputDir = join(workdir, "artifacts");
      await mkdir(outputDir, { mode: 0o700 });
      await writeFile(inputPath, await this.storage.get(version.objectKey), { mode: 0o600 });

      const entitlement = await this.entitlements.forOrganization(job.organizationId);
      const params = (job.parameters ?? {}) as { actions?: string[]; methods?: Record<string, string> };
      const timeoutMs = job.type === "TRAIN" ? this.config.worker.trainTimeoutMs : this.config.worker.timeoutMs;
      const output = await runPythonWorker(
        { ...this.config.worker, timeoutMs, cwd: workdir },
        {
          type: job.type,
          input_path: inputPath,
          output_path: outputPath,
          filename: version.originalFilename,
          dataset_name: job.dataset.name,
          max_file_mb: Math.max(entitlement.limits.maxFileMb, Math.ceil(version.fileSizeBytes / 1048576)),
          output_dir: outputDir,
          actions: params.actions ?? [],
          methods: params.methods ?? {},
          params: job.parameters ?? {},
        },
      );

      if (!output.ok) {
        await this.finish(job, { status: "FAILED", errorMessage: output.error.slice(0, 500) });
        return;
      }
      const artifacts = await collectArtifacts(outputDir, output.artifacts);
      if (job.type === "PROFILE") await this.completeProfile(job, output.result);
      else if (job.type === "REPAIR") await this.completeRepair(job, output.result, await readFile(outputPath));
      else await this.completeOperation(job, output.result, artifacts);
    } catch (error) {
      this.logger.error(`Job ${job.id} crashed: ${(error as Error).message}`);
      const retry = job.attempts < MAX_ATTEMPTS && !(error as Error).message.includes("timed out");
      await this.prisma.processingJob.update({
        where: { id: job.id },
        data: retry
          ? { status: "QUEUED" }
          : { status: "FAILED", errorMessage: "Processing failed unexpectedly. Our team has been notified.", finishedAt: new Date() },
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  /** Store each output file encrypted, then record artifacts and the result atomically. */
  private async completeOperation(job: ClaimedJob, result: Record<string, unknown>, artifacts: CollectedArtifact[]): Promise<void> {
    const stored: { artifact: CollectedArtifact; objectKey: string; sha256: string; size: number }[] = [];
    try {
      for (const artifact of artifacts) {
        stored.push({ artifact, ...(await this.storage.put(job.organizationId, artifact.data)) });
      }
      await this.prisma.$transaction(async (tx) => {
        if (stored.length) {
          await tx.artifact.createMany({
            data: stored.map(({ artifact, objectKey, sha256, size }) => ({
              organizationId: job.organizationId,
              datasetId: job.datasetId,
              datasetVersionId: job.datasetVersionId,
              jobId: job.id,
              createdById: job.createdById,
              kind: artifact.kind,
              title: artifact.title,
              filename: artifact.filename,
              contentType: artifact.contentType,
              objectKey,
              sha256,
              sizeBytes: size,
              metadata: (artifact.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
            })),
          });
        }
        await tx.processingJob.update({
          where: { id: job.id },
          data: { status: "SUCCEEDED", result: result as Prisma.InputJsonValue, finishedAt: new Date(), errorMessage: null },
        });
        await tx.dataset.update({ where: { id: job.datasetId }, data: { updatedAt: new Date() } });
      });
    } catch (error) {
      await Promise.all(stored.map((s) => this.storage.delete(s.objectKey)));
      throw error;
    }
  }

  private async completeProfile(job: ClaimedJob, result: Record<string, unknown>): Promise<void> {
    const overview = result.overview as { rows?: number; columns?: number } | undefined;
    await this.prisma.$transaction([
      this.prisma.datasetVersion.update({
        where: { id: job.datasetVersionId },
        data: { rowCount: overview?.rows ?? null, columnCount: overview?.columns ?? null, repairPlan: result.repairPlan as Prisma.InputJsonValue },
      }),
      this.prisma.processingJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", result: result as Prisma.InputJsonValue, finishedAt: new Date(), errorMessage: null },
      }),
    ]);
  }

  private async completeRepair(job: ClaimedJob, result: Record<string, unknown>, repaired: Buffer): Promise<void> {
    const stored = await this.storage.put(job.organizationId, repaired);
    const parent = job.datasetVersion;
    const base = parent.originalFilename.replace(/\.(csv|xlsx)$/i, "");
    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialise version numbering per dataset.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${job.datasetId}))`;
        const latest = await tx.datasetVersion.aggregate({ where: { datasetId: job.datasetId }, _max: { versionNumber: true } });
        const after = result.after as { rows?: number; columns?: number } | undefined;
        const version = await tx.datasetVersion.create({
          data: {
            datasetId: job.datasetId,
            organizationId: job.organizationId,
            createdById: job.createdById,
            versionNumber: (latest._max.versionNumber ?? 0) + 1,
            kind: "REPAIRED",
            parentVersionId: parent.id,
            originalFilename: `${base}.csv`,
            objectKey: stored.objectKey,
            sha256: stored.sha256,
            fileSizeBytes: stored.size,
            contentType: CONTENT_TYPES[".csv"],
            rowCount: after?.rows ?? null,
            columnCount: after?.columns ?? null,
            repairPlan: job.parameters as Prisma.InputJsonValue,
            appliedRepairs: result.applied as Prisma.InputJsonValue,
          },
        });
        await tx.processingJob.update({
          where: { id: job.id },
          data: { status: "SUCCEEDED", result: result as Prisma.InputJsonValue, outputVersionId: version.id, finishedAt: new Date(), errorMessage: null },
        });
        // Profile the new version automatically; not counted against limits.
        await tx.processingJob.create({
          data: {
            organizationId: job.organizationId,
            datasetId: job.datasetId,
            datasetVersionId: version.id,
            createdById: job.createdById,
            type: "PROFILE",
            parameters: { trigger: "repair", parentJobId: job.id },
            billable: false,
          },
        });
        await tx.dataset.update({ where: { id: job.datasetId }, data: { updatedAt: new Date() } });
        await this.audit.record(
          {
            action: "dataset.version_created",
            actorUserId: job.createdById,
            organizationId: job.organizationId,
            subjectType: "datasetVersion",
            subjectId: version.id,
            metadata: { parentVersionId: parent.id, sha256: stored.sha256 },
          },
          tx,
        );
      });
    } catch (error) {
      await this.storage.delete(stored.objectKey);
      throw error;
    }
  }
}

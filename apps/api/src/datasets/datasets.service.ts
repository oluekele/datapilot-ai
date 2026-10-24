import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { extname } from "node:path";
import { AuditService } from "../common/audit.service";
import { TenantContext } from "../common/auth-context";
import { AppError, notFound } from "../common/errors";
import { PrismaService } from "../database/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { StorageService } from "../storage/storage.service";
import { OperationDto, RepairDto } from "./datasets.dto";
import { creatorSelect, serializeJob, serializeVersion } from "./serializers";

export const CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type UploadedFile = { originalname: string; buffer: Buffer; size: number };

/** Keep a filename safe for display and Content-Disposition. */
export function cleanFilename(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, "_")
    .trim()
    .slice(-200);
  return cleaned || "dataset.csv";
}

@Injectable()
export class DatasetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: TenantContext) {
    const datasets = await this.prisma.dataset.findMany({
      where: { organizationId: ctx.organization.id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      include: {
        createdBy: creatorSelect,
        versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { createdBy: creatorSelect } },
        jobs: { orderBy: { createdAt: "desc" }, take: 1, include: { createdBy: creatorSelect } },
        _count: { select: { versions: true } },
      },
    });
    return datasets.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      createdBy: { displayName: d.createdBy.displayName },
      versionCount: d._count.versions,
      latestVersion: d.versions[0] ? serializeVersion(d.versions[0]) : null,
      lastJob: d.jobs[0] ? serializeJob(d.jobs[0]) : null,
    }));
  }

  /** Every lookup is scoped by organisation; another tenant's id is simply "not found". */
  private async findDataset(ctx: TenantContext, id: string) {
    const dataset = await this.prisma.dataset.findFirst({
      where: { id, organizationId: ctx.organization.id, deletedAt: null },
    });
    if (!dataset) throw notFound("Dataset");
    return dataset;
  }

  private async findVersion(ctx: TenantContext, datasetId: string, versionId: string) {
    await this.findDataset(ctx, datasetId);
    const version = await this.prisma.datasetVersion.findFirst({
      where: { id: versionId, datasetId, organizationId: ctx.organization.id },
    });
    if (!version) throw notFound("Version");
    return version;
  }

  async upload(ctx: TenantContext, file: UploadedFile | undefined, name: string | undefined, req: Request) {
    if (!file?.buffer?.length) throw new AppError(400, "BAD_REQUEST", "Choose a non-empty file to upload.");
    const filename = cleanFilename(file.originalname);
    const extension = extname(filename).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) throw new AppError(400, "BAD_REQUEST", "Upload a .csv or .xlsx file.");
    if (extension === ".xlsx" && file.buffer.subarray(0, 4).toString("hex") !== "504b0304") {
      throw new AppError(400, "BAD_REQUEST", "This file is not a valid Excel workbook.");
    }

    // Check limits before writing anything, then again atomically below.
    await this.prisma.$transaction((tx) => this.entitlements.assertCanUpload(tx, ctx.organization.id, file.size));
    const stored = await this.storage.put(ctx.organization.id, file.buffer);
    try {
      const datasetId = await this.prisma.$transaction(async (tx) => {
        await this.entitlements.assertCanUpload(tx, ctx.organization.id, file.size);
        const dataset = await tx.dataset.create({
          data: {
            organizationId: ctx.organization.id,
            createdById: ctx.user.id,
            name: (name?.trim() || filename.replace(/\.(csv|xlsx)$/i, "")).slice(0, 255),
          },
        });
        const version = await tx.datasetVersion.create({
          data: {
            datasetId: dataset.id,
            organizationId: ctx.organization.id,
            createdById: ctx.user.id,
            versionNumber: 1,
            kind: "RAW",
            originalFilename: filename,
            objectKey: stored.objectKey,
            sha256: stored.sha256,
            fileSizeBytes: stored.size,
            contentType,
          },
        });
        await tx.processingJob.create({
          data: {
            organizationId: ctx.organization.id,
            datasetId: dataset.id,
            datasetVersionId: version.id,
            createdById: ctx.user.id,
            type: "PROFILE",
            parameters: { trigger: "upload" },
            billable: false,
          },
        });
        await this.audit.record(
          {
            action: "dataset.uploaded",
            actorUserId: ctx.user.id,
            organizationId: ctx.organization.id,
            subjectType: "dataset",
            subjectId: dataset.id,
            metadata: { filename, bytes: stored.size, sha256: stored.sha256 },
            req,
          },
          tx,
        );
        return dataset.id;
      });
      return { id: datasetId };
    } catch (error) {
      await this.storage.delete(stored.objectKey);
      throw error;
    }
  }

  async detail(ctx: TenantContext, id: string) {
    const dataset = await this.findDataset(ctx, id);
    const [versions, jobs, creator] = await Promise.all([
      this.prisma.datasetVersion.findMany({
        where: { datasetId: id, organizationId: ctx.organization.id },
        orderBy: { versionNumber: "desc" },
        include: { createdBy: creatorSelect },
      }),
      this.prisma.processingJob.findMany({
        where: { datasetId: id, organizationId: ctx.organization.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { createdBy: creatorSelect },
      }),
      this.prisma.user.findUnique({ where: { id: dataset.createdById }, select: { displayName: true } }),
    ]);
    return {
      id: dataset.id,
      name: dataset.name,
      createdAt: dataset.createdAt,
      createdBy: { displayName: creator?.displayName ?? "" },
      versions: versions.map(serializeVersion),
      jobs: jobs.map((j) => serializeJob(j)),
    };
  }

  async remove(ctx: TenantContext, id: string, req: Request) {
    const dataset = await this.findDataset(ctx, id);
    if (ctx.role === "MEMBER" && dataset.createdById !== ctx.user.id) {
      throw new AppError(403, "FORBIDDEN_ROLE", "Only the uploader or an administrator can delete this dataset.");
    }
    const versions = await this.prisma.datasetVersion.findMany({
      where: { datasetId: id, organizationId: ctx.organization.id },
    });
    const artifacts = await this.prisma.artifact.findMany({
      where: { datasetId: id, organizationId: ctx.organization.id, objectKey: { not: null } },
      select: { objectKey: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.dataset.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.processingJob.updateMany({
        where: { datasetId: id, status: "QUEUED" },
        data: { status: "CANCELED", finishedAt: new Date() },
      });
      await tx.datasetVersion.updateMany({
        where: { datasetId: id },
        data: { objectKey: null, purgedAt: new Date() },
      });
      await tx.artifact.updateMany({
        where: { datasetId: id, deletedAt: null },
        data: { objectKey: null, deletedAt: new Date() },
      });
      await this.audit.record(
        {
          action: "dataset.deleted",
          actorUserId: ctx.user.id,
          organizationId: ctx.organization.id,
          subjectType: "dataset",
          subjectId: id,
          metadata: { name: dataset.name, versions: versions.length, artifacts: artifacts.length },
          req,
        },
        tx,
      );
    });
    // File bytes are removed after the metadata commit; the history remains.
    const keys = [...versions.map((v) => v.objectKey), ...artifacts.map((a) => a.objectKey)];
    await Promise.all(keys.filter((key): key is string => !!key).map((key) => this.storage.delete(key)));
    return { ok: true };
  }

  async download(ctx: TenantContext, datasetId: string, versionId: string, req: Request) {
    const version = await this.findVersion(ctx, datasetId, versionId);
    if (!version.objectKey) throw new AppError(410 as number, "NOT_FOUND", "This file has been deleted.");
    const data = await this.storage.get(version.objectKey);
    await this.audit.record({
      action: "dataset.downloaded",
      actorUserId: ctx.user.id,
      organizationId: ctx.organization.id,
      subjectType: "datasetVersion",
      subjectId: version.id,
      req,
    });
    const base = version.originalFilename.replace(/\.(csv|xlsx)$/i, "");
    const ext = extname(version.originalFilename).toLowerCase();
    const filename = version.kind === "RAW" ? version.originalFilename : `${base}-v${version.versionNumber}-repaired${ext}`;
    return { data, filename, contentType: version.contentType };
  }

  async report(ctx: TenantContext, datasetId: string, versionId: string) {
    const version = await this.findVersion(ctx, datasetId, versionId);
    const job = await this.prisma.processingJob.findFirst({
      where: { datasetVersionId: version.id, organizationId: ctx.organization.id, type: "PROFILE", status: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
    });
    const markdown = (job?.result as { reportMarkdown?: string } | null)?.reportMarkdown;
    if (!markdown) throw new AppError(404, "NOT_FOUND", "No report yet. Run a profile first.");
    const base = version.originalFilename.replace(/\.(csv|xlsx)$/i, "");
    return { data: Buffer.from(markdown), filename: `${base}-v${version.versionNumber}-report.md` };
  }

  private async enqueue(
    ctx: TenantContext,
    datasetId: string,
    versionId: string,
    type: "PROFILE" | "REPAIR" | OperationDto["operation"],
    parameters: Prisma.InputJsonObject,
    req: Request,
  ) {
    const version = await this.findVersion(ctx, datasetId, versionId);
    if (!version.objectKey) throw new AppError(410 as number, "NOT_FOUND", "This file has been deleted.");
    const job = await this.prisma.$transaction(async (tx) => {
      await this.entitlements.assertCanRunJob(tx, ctx.organization.id);
      const job = await tx.processingJob.create({
        data: {
          organizationId: ctx.organization.id,
          datasetId,
          datasetVersionId: versionId,
          createdById: ctx.user.id,
          type,
          parameters,
        },
        include: { createdBy: creatorSelect },
      });
      await tx.dataset.update({ where: { id: datasetId }, data: { updatedAt: new Date() } });
      await this.audit.record(
        {
          action: `job.${type.toLowerCase()}_requested`,
          actorUserId: ctx.user.id,
          organizationId: ctx.organization.id,
          subjectType: "job",
          subjectId: job.id,
          req,
        },
        tx,
      );
      return job;
    });
    return serializeJob(job);
  }

  profile(ctx: TenantContext, datasetId: string, versionId: string, req: Request) {
    return this.enqueue(ctx, datasetId, versionId, "PROFILE", { trigger: "manual" }, req);
  }

  repair(ctx: TenantContext, datasetId: string, versionId: string, dto: RepairDto, req: Request) {
    const methods: Record<string, string> = {};
    for (const [key, value] of Object.entries(dto.methods ?? {})) {
      if (typeof value !== "string" || key.length > 300 || value.length > 50) {
        throw new AppError(400, "BAD_REQUEST", "Invalid repair method selection.");
      }
      methods[key] = value;
    }
    return this.enqueue(ctx, datasetId, versionId, "REPAIR", { actions: dto.actions, methods }, req);
  }

  operation(ctx: TenantContext, datasetId: string, versionId: string, dto: OperationDto, req: Request) {
    const params = dto.params ?? {};
    if (JSON.stringify(params).length > 20_000) {
      throw new AppError(400, "BAD_REQUEST", "These settings are too large.");
    }
    return this.enqueue(ctx, datasetId, versionId, dto.operation, params as Prisma.InputJsonObject, req);
  }
}

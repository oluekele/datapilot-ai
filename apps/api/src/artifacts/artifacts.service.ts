import { Injectable } from "@nestjs/common";
import type { ArtifactKind, Prisma } from "@prisma/client";
import type { Request } from "express";
import { zipSync, type Zippable } from "fflate";
import { AuditService } from "../common/audit.service";
import { TenantContext } from "../common/auth-context";
import { AppError, notFound } from "../common/errors";
import { PrismaService } from "../database/prisma.service";
import { StorageService } from "../storage/storage.service";

const KINDS: ArtifactKind[] = ["CHART", "TABLE", "MODEL", "REPORT", "CODE", "DATA"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ARCHIVE_FILES = 200;
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

const artifactInclude = {
  dataset: { select: { name: true } },
  datasetVersion: { select: { versionNumber: true } },
  job: { select: { type: true } },
  createdBy: { select: { displayName: true } },
} satisfies Prisma.ArtifactInclude;

type ArtifactRow = Prisma.ArtifactGetPayload<{ include: typeof artifactInclude }>;

export type ArtifactFilters = { datasetId?: string; jobId?: string; kind?: string; q?: string };

function slug(value: string): string {
  return value.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "item";
}

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  serialize(a: ArtifactRow) {
    return {
      id: a.id,
      kind: a.kind,
      title: a.title,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      datasetId: a.datasetId,
      datasetName: a.dataset.name,
      datasetVersionId: a.datasetVersionId,
      versionNumber: a.datasetVersion.versionNumber,
      jobId: a.jobId,
      jobType: a.job.type,
      createdAt: a.createdAt,
      createdBy: { displayName: a.createdBy.displayName },
      previewable: a.contentType === "image/png",
      metadata: a.metadata,
    };
  }

  /** Tenant-scoped filter; ids from the query string are validated, never trusted. */
  private where(ctx: TenantContext, f: ArtifactFilters): Prisma.ArtifactWhereInput {
    const where: Prisma.ArtifactWhereInput = {
      organizationId: ctx.organization.id,
      deletedAt: null,
      objectKey: { not: null },
      dataset: { deletedAt: null },
    };
    if (f.datasetId) {
      if (!UUID.test(f.datasetId)) throw new AppError(400, "BAD_REQUEST", "Invalid dataset id.");
      where.datasetId = f.datasetId;
    }
    if (f.jobId) {
      if (!UUID.test(f.jobId)) throw new AppError(400, "BAD_REQUEST", "Invalid job id.");
      where.jobId = f.jobId;
    }
    if (f.kind) {
      const kind = f.kind.toUpperCase() as ArtifactKind;
      if (!KINDS.includes(kind)) throw new AppError(400, "BAD_REQUEST", "Unknown artifact kind.");
      where.kind = kind;
    }
    const q = f.q?.trim().slice(0, 100);
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { filename: { contains: q, mode: "insensitive" } },
        { dataset: { name: { contains: q, mode: "insensitive" } } },
      ];
    }
    return where;
  }

  async list(ctx: TenantContext, f: ArtifactFilters, limit: number, cursor?: string) {
    const take = Math.min(Math.max(limit || 48, 1), 100);
    if (cursor && !UUID.test(cursor)) throw new AppError(400, "BAD_REQUEST", "Invalid cursor.");
    const rows = await this.prisma.artifact.findMany({
      where: this.where(ctx, f),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: artifactInclude,
    });
    const items = rows.slice(0, take).map((a) => this.serialize(a));
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }

  private async find(ctx: TenantContext, id: string) {
    const artifact = await this.prisma.artifact.findFirst({
      where: { id, ...this.where(ctx, {}) },
      include: artifactInclude,
    });
    if (!artifact?.objectKey) throw notFound("File");
    return artifact;
  }

  async file(ctx: TenantContext, id: string, req: Request, purpose: "download" | "preview") {
    const artifact = await this.find(ctx, id);
    if (purpose === "preview" && artifact.contentType !== "image/png") {
      throw new AppError(400, "BAD_REQUEST", "This file has no preview.");
    }
    const data = await this.storage.get(artifact.objectKey!);
    if (purpose === "download") {
      await this.audit.record({
        action: "artifact.downloaded",
        actorUserId: ctx.user.id,
        organizationId: ctx.organization.id,
        subjectType: "artifact",
        subjectId: artifact.id,
        req,
      });
    }
    return { data, filename: artifact.filename, contentType: artifact.contentType };
  }

  async archive(ctx: TenantContext, ids: string[] | undefined, f: ArtifactFilters, req: Request) {
    let where = this.where(ctx, f);
    if (ids?.length) {
      if (ids.length > MAX_ARCHIVE_FILES || ids.some((id) => !UUID.test(id))) {
        throw new AppError(400, "BAD_REQUEST", `Select up to ${MAX_ARCHIVE_FILES} valid files.`);
      }
      where = { ...where, id: { in: ids } };
    } else if (!f.datasetId && !f.jobId && !f.kind && !f.q) {
      throw new AppError(400, "BAD_REQUEST", "Choose files or a filter to download.");
    }
    const rows = await this.prisma.artifact.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_ARCHIVE_FILES + 1,
      include: artifactInclude,
    });
    if (!rows.length) throw notFound("Files");
    if (rows.length > MAX_ARCHIVE_FILES) {
      throw new AppError(400, "BAD_REQUEST", `That is more than ${MAX_ARCHIVE_FILES} files. Narrow the filter.`);
    }
    if (rows.reduce((n, a) => n + a.sizeBytes, 0) > MAX_ARCHIVE_BYTES) {
      throw new AppError(400, "BAD_REQUEST", "Those files are too large to download together. Narrow the selection.");
    }

    // Folder per dataset, then per run: "<dataset>/<job type>-<date>-<id>/<file>".
    const tree: Zippable = {};
    for (const a of rows) {
      const run = `${a.job.type.toLowerCase()}-${a.createdAt.toISOString().slice(0, 10)}-${a.jobId.slice(0, 8)}`;
      const dir = (tree[slug(a.dataset.name)] ??= {}) as Zippable;
      const runDir = (dir[run] ??= {}) as Zippable;
      let name = a.filename;
      for (let n = 2; name in runDir; n++) name = a.filename.replace(/(\.[^.]*)?$/, `-${n}$1`);
      // Already-compressed formats are stored, not re-compressed.
      const level = /^(image\/png|application\/octet-stream|application\/vnd\.openxml)/.test(a.contentType) ? 0 : 6;
      runDir[name] = [await this.storage.get(a.objectKey!), { level }];
    }
    const data = Buffer.from(zipSync(tree));
    await this.audit.record({
      action: "artifact.archive_downloaded",
      actorUserId: ctx.user.id,
      organizationId: ctx.organization.id,
      metadata: { count: rows.length, filters: { ...f }, explicitIds: !!ids?.length },
      req,
    });
    const scope = f.jobId ? `run-${f.jobId.slice(0, 8)}` : rows.length === 1 || f.datasetId ? slug(rows[0].dataset.name) : "library";
    return { data, filename: `datapilot-${scope}-${new Date().toISOString().slice(0, 10)}.zip` };
  }

  async remove(ctx: TenantContext, id: string, req: Request) {
    const artifact = await this.find(ctx, id);
    if (ctx.role === "MEMBER" && artifact.createdById !== ctx.user.id) {
      throw new AppError(403, "FORBIDDEN_ROLE", "Only the person who created this file or an administrator can delete it.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.artifact.update({ where: { id }, data: { deletedAt: new Date(), objectKey: null } });
      await this.audit.record(
        {
          action: "artifact.deleted",
          actorUserId: ctx.user.id,
          organizationId: ctx.organization.id,
          subjectType: "artifact",
          subjectId: id,
          metadata: { title: artifact.title, filename: artifact.filename },
          req,
        },
        tx,
      );
    });
    await this.storage.delete(artifact.objectKey!);
    return { ok: true };
  }
}

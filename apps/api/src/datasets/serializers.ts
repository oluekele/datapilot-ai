import type { DatasetVersion, ProcessingJob, Prisma, User } from "@prisma/client";

type WithCreator = { createdBy: Pick<User, "displayName"> };

export const creatorSelect = { select: { displayName: true } } as const;

export function serializeVersion(v: DatasetVersion & WithCreator) {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    kind: v.kind,
    parentVersionId: v.parentVersionId,
    originalFilename: v.originalFilename,
    fileSizeBytes: v.fileSizeBytes,
    sha256: v.sha256,
    rowCount: v.rowCount,
    columnCount: v.columnCount,
    appliedRepairs: v.appliedRepairs,
    purged: !!v.purgedAt,
    createdAt: v.createdAt,
    createdBy: { displayName: v.createdBy.displayName },
  };
}

/** The Markdown report is large and served by its own endpoint. */
export function publicResult(result: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (result && typeof result === "object" && !Array.isArray(result) && "reportMarkdown" in result) {
    const { reportMarkdown: _omit, ...rest } = result;
    return rest;
  }
  return result;
}

export function serializeJob(
  j: ProcessingJob &
    WithCreator & { dataset?: { name: string }; organization?: { name: string } },
) {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    datasetId: j.datasetId,
    ...(j.dataset ? { datasetName: j.dataset.name } : {}),
    ...(j.organization ? { organizationId: j.organizationId, organizationName: j.organization.name } : {}),
    datasetVersionId: j.datasetVersionId,
    outputVersionId: j.outputVersionId,
    parameters: j.parameters,
    result: publicResult(j.result),
    errorMessage: j.errorMessage,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    createdBy: { displayName: j.createdBy.displayName },
  };
}

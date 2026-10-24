-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('CHART', 'TABLE', 'MODEL', 'REPORT', 'CODE', 'DATA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProcessingJobType" ADD VALUE 'EXPLORE';
ALTER TYPE "ProcessingJobType" ADD VALUE 'ANALYZE';
ALTER TYPE "ProcessingJobType" ADD VALUE 'VISUALIZE';
ALTER TYPE "ProcessingJobType" ADD VALUE 'TRAIN';

-- CreateTable
CREATE TABLE "Artifact" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "datasetVersionId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(127) NOT NULL,
    "objectKey" VARCHAR(512),
    "sha256" CHAR(64) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_objectKey_key" ON "Artifact"("objectKey");

-- CreateIndex
CREATE INDEX "Artifact_organizationId_deletedAt_createdAt_idx" ON "Artifact"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_organizationId_kind_createdAt_idx" ON "Artifact"("organizationId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_datasetId_createdAt_idx" ON "Artifact"("datasetId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_jobId_idx" ON "Artifact"("jobId");

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_datasetId_organizationId_fkey" FOREIGN KEY ("datasetId", "organizationId") REFERENCES "Dataset"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "DatasetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

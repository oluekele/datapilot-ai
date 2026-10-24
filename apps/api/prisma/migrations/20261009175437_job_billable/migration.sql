-- AlterTable
ALTER TABLE "ProcessingJob" ADD COLUMN     "billable" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "ProcessingJob_organizationId_billable_createdAt_idx" ON "ProcessingJob"("organizationId", "billable", "createdAt");

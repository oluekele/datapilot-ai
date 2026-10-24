import type { ArtifactKind } from "@prisma/client";
import { lstat, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

/** One output file announced by the Python worker. */
export type ManifestEntry = {
  file: string;
  kind: string;
  title: string;
  content_type: string;
  metadata?: Record<string, unknown> | null;
};

export type CollectedArtifact = {
  kind: ArtifactKind;
  title: string;
  filename: string;
  contentType: string;
  metadata: Record<string, unknown> | null;
  data: Buffer;
};

const KINDS = new Set<ArtifactKind>(["CHART", "TABLE", "MODEL", "REPORT", "CODE", "DATA"]);

// Only these types are stored; anything else from the worker is rejected.
export const ARTIFACT_CONTENT_TYPES = new Set([
  "image/png",
  "image/svg+xml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/x-python",
  "application/json",
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MAX_FILES = 120;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

/**
 * Validate the worker's artifact manifest and read the files. The worker is
 * our own code, but its output is still treated as untrusted: names must be
 * bare filenames inside the job's temp directory (no paths, no symlinks), and
 * kinds, types and sizes are bounded.
 */
export async function collectArtifacts(outputDir: string, manifest: unknown): Promise<CollectedArtifact[]> {
  if (manifest === undefined || manifest === null) return [];
  if (!Array.isArray(manifest)) throw new Error("Worker artifact manifest is not a list");
  if (manifest.length > MAX_FILES) throw new Error(`Worker produced more than ${MAX_FILES} artifacts`);

  const seen = new Set<string>();
  let total = 0;
  const collected: CollectedArtifact[] = [];
  for (const raw of manifest as ManifestEntry[]) {
    const file = String(raw?.file ?? "");
    if (!file || basename(file) !== file || file.startsWith(".") || seen.has(file)) {
      throw new Error(`Invalid artifact filename: ${file.slice(0, 80)}`);
    }
    seen.add(file);
    const kind = String(raw.kind) as ArtifactKind;
    if (!KINDS.has(kind)) throw new Error(`Invalid artifact kind for ${file}`);
    const contentType = String(raw.content_type);
    if (!ARTIFACT_CONTENT_TYPES.has(contentType)) throw new Error(`Disallowed artifact type ${contentType} for ${file}`);

    const path = join(outputDir, file);
    const info = await lstat(path);
    if (!info.isFile()) throw new Error(`Artifact ${file} is not a regular file`);
    if (info.size > MAX_FILE_BYTES) throw new Error(`Artifact ${file} is too large`);
    total += info.size;
    if (total > MAX_TOTAL_BYTES) throw new Error("Worker artifacts exceed the total size limit");

    const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : null;
    if (metadata && JSON.stringify(metadata).length > 10_000) throw new Error(`Artifact ${file} metadata is too large`);
    collected.push({
      kind,
      title: String(raw.title || file).slice(0, 200),
      filename: file.slice(0, 255),
      contentType,
      metadata,
      data: await readFile(path),
    });
  }
  return collected;
}

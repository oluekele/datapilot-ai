import { Inject, Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { sha256 } from "../common/crypto";
import { APP_CONFIG } from "../common/tokens";
import type { AppConfig } from "../config";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Private, encrypted-at-rest object storage on the local filesystem.
 * Objects are AES-256-GCM encrypted ([iv][ciphertext][tag]) and addressed by
 * opaque server-generated keys; clients never supply or see a key.
 *
 * Swap this for an S3-compatible implementation in production, keeping the
 * same interface and encrypting server-side.
 */
@Injectable()
export class StorageService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private pathFor(objectKey: string): string {
    const base = this.config.storage.dir;
    const full = resolve(base, objectKey);
    if (!full.startsWith(base + sep)) throw new Error("Invalid object key");
    return full;
  }

  async put(
    organizationId: string,
    data: Buffer,
  ): Promise<{ objectKey: string; sha256: string; size: number }> {
    const objectKey = join(organizationId, randomUUID());
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.config.storage.encryptionKey, iv);
    // Bind the ciphertext to its key so objects cannot be swapped on disk.
    cipher.setAAD(Buffer.from(objectKey));
    const body = Buffer.concat([iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, body, { mode: 0o600, flag: "wx" });
    return { objectKey, sha256: sha256(data), size: data.length };
  }

  async get(objectKey: string): Promise<Buffer> {
    const body = await readFile(this.pathFor(objectKey));
    const iv = body.subarray(0, IV_BYTES);
    const tag = body.subarray(body.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.config.storage.encryptionKey, iv);
    decipher.setAAD(Buffer.from(objectKey));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(body.subarray(IV_BYTES, body.length - TAG_BYTES)),
      decipher.final(),
    ]);
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.pathFor(objectKey), { force: true });
  }
}

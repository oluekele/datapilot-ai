import type { Response } from "express";

/** Headers for a private file download with a safe, Unicode-aware filename. */
export function attachment(res: Response, filename: string, contentType: string): void {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.set({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "private, no-store",
  });
}

/**
 * Headers for an inline image preview. The sandbox CSP stops the response from
 * running anything even if it were opened directly as a document.
 */
export function inlineImage(res: Response, contentType: string): void {
  res.set({
    "Content-Type": contentType,
    "Content-Disposition": "inline",
    "Cache-Control": "private, max-age=300",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
}

import { randomBytes } from "node:crypto";

/** Human-readable, collision-resistant organisation slug. */
export function makeSlug(name: string): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 60) || "org";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

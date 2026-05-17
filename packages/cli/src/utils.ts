import { randomBytes } from "node:crypto";

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export function formatProjectName(name: string): string {
  const formatted = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return formatted || "my-nexpress-site";
}

/**
 * Deterministic host-port pick for the scaffold's Postgres
 * container. Two scaffolds on the same machine that both default
 * to 5433 collide on `docker compose up`: the second project
 * can't bind, but the error is easy to mistake for a transient
 * docker issue. Hashing the project name into a 1000-port range
 * (5433–6432) gives every scaffold a stable, distinct port
 * without needing async net-probing.
 *
 * Birthday-paradox math: with 1000 buckets the collision risk
 * is ~1% at five projects and ~50% at ~37 projects. Practical
 * single-developer collision risk is negligible. When a clash
 * does happen, the operator just edits `NEXPRESS_DB_PORT` in
 * `.env` to anything free.
 *
 * Same algorithm as Java's String.hashCode (× 31 mixing) — gives
 * a reasonable distribution over short ASCII strings, easy to
 * reimplement in any language a downstream port-derivation
 * helper might land in.
 */
export function dbPortFromProject(projectName: string): number {
  let hash = 0;
  for (let i = 0; i < projectName.length; i += 1) {
    hash = (hash * 31 + projectName.charCodeAt(i)) | 0;
  }
  return 5433 + (Math.abs(hash) % 1000);
}

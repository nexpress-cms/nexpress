/**
 * Phase 21.14 — resume marker.
 *
 * The applier writes the ids of every successfully imported entity
 * to a sidecar JSON file next to the WXR. On re-run the file is
 * read first, and the applier:
 *
 *   - Skips documents whose `(collection, slug)` is already in the
 *     marker — the import respects the previous run's mapping
 *     instead of re-querying the DB.
 *   - Skips comments whose `wpCommentId` is already in the marker
 *     — closes the design-§9 idempotency gap (re-runs no longer
 *     create duplicate `nx_comments` rows).
 *   - Reuses media-id mappings so a partial-failure mid-pipeline
 *     doesn't have to re-download the bytes that already landed.
 *
 * The marker is opt-in: callers without a `resume` deps run the
 * historical "skip on slug" behavior. Operators who want crash-
 * recovery pass `--resume` to the CLI.
 *
 * Schema is versioned so future shape changes can migrate
 * forward; today's shape is `version: 1`.
 */

import { readFileSync, writeFileSync } from "node:fs";

export interface ResumeState {
  version: 1;
  /** WXR path the marker was first written for — sanity check. */
  source: string;
  startedAt: string;
  updatedAt: string;
  /** `${collection}/${slug}` → NexPress doc id. */
  documents: Record<string, string>;
  /** WP comment id (numeric) → NexPress nx_comments.id. */
  comments: Record<number, string>;
  /** WP author login → NexPress nx_users.id. */
  authors: Record<string, string>;
  /** WP attachment URL → NexPress nx_media.id. */
  media: Record<string, string>;
  /** `${taxonomy}:${slug}` → NexPress taxonomy term id. */
  taxonomies: Record<string, string>;
}

export interface ResumeDeps {
  state: ResumeState;
  /**
   * Persist the current state to disk. Called after each record-
   * level success so a crash mid-import doesn't lose work. Errors
   * are surfaced — a marker that can't be written defeats the
   * whole point.
   */
  persist: () => void;
}

export function emptyResumeState(source: string): ResumeState {
  const now = new Date().toISOString();
  return {
    version: 1,
    source,
    startedAt: now,
    updatedAt: now,
    documents: {},
    comments: {},
    authors: {},
    media: {},
    taxonomies: {},
  };
}

export class ResumeStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeStateError";
  }
}

/**
 * Load a resume state file from disk. Missing file → fresh state.
 * Malformed file → throw so the operator can decide whether to
 * delete the marker or fix it (deletion silently in the importer
 * would erase the prior run's progress, which is the wrong default).
 */
export function loadResumeState(path: string, source: string): ResumeState {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyResumeState(source);
    }
    throw new ResumeStateError(
      `cannot read resume state ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ResumeStateError(
      `${path}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ResumeStateError(`${path}: top-level value must be a JSON object`);
  }
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1) {
    throw new ResumeStateError(`${path}: unsupported version ${String(root.version)}`);
  }
  return {
    version: 1,
    source: typeof root.source === "string" ? root.source : source,
    startedAt: typeof root.startedAt === "string" ? root.startedAt : new Date().toISOString(),
    updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : new Date().toISOString(),
    documents: asStringMap(root.documents),
    comments: asNumberKeyMap(root.comments),
    authors: asStringMap(root.authors),
    media: asStringMap(root.media),
    taxonomies: asStringMap(root.taxonomies),
  };
}

export function persistResumeState(path: string, state: ResumeState): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

export function documentKey(collection: string, slug: string): string {
  return `${collection}/${slug}`;
}

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function asNumberKeyMap(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number.parseInt(k, 10);
    if (Number.isFinite(n) && typeof v === "string") out[n] = v;
  }
  return out;
}

import { and, desc, eq, count } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NxForbiddenError, NxNotFoundError, NxValidationError } from "../errors.js";
import { nxRevisions } from "../db/schema/system.js";
import type { NxAuthUser, NxSaveResult } from "../config/types.js";
import { getCollectionConfig } from "./registry.js";
import { getDb, getDocumentById, saveDocument } from "./pipeline.js";

export type NxRevisionStatus = "draft" | "published" | "autosave";

export interface NxRevisionSummary {
  id: string;
  collection: string;
  documentId: string;
  version: number;
  status: NxRevisionStatus;
  changedFields: string[];
  authorId: string | null;
  createdAt: Date;
}

export interface NxRevision extends NxRevisionSummary {
  snapshot: Record<string, unknown>;
}

export interface NxRevisionListOptions {
  limit?: number;
  offset?: number;
}

export interface NxRevisionListResult {
  revisions: NxRevisionSummary[];
  total: number;
}

interface DrizzleDb {
  select: NodePgDatabase<Record<string, unknown>>["select"];
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return 20;
  return Math.min(Math.floor(limit), 100);
}

function normalizeOffset(offset: number | undefined): number {
  if (!offset || offset < 0) return 0;
  return Math.floor(offset);
}

function assertVersionsEnabled(collection: string): void {
  const config = getCollectionConfig(collection);
  if (!config.versions) {
    throw new NxValidationError("Revisions not enabled", [
      {
        field: "collection",
        message: `Collection "${collection}" has no versions config — enable versions.drafts to persist revisions.`,
      },
    ]);
  }
}

/**
 * Revisions can include draft / autosave snapshots that the public
 * site never serves. Authorizing revision reads with `access.read`
 * was leaking those to any user who could read the published
 * document — for `posts`/`pages` that's anyone, including a
 * logged-in viewer account. (#58)
 *
 * Switch the gate to `access.update`: only users who could PUBLISH
 * the document get to peek at its history. When the collection
 * doesn't define `access.update`, fall back to a hard staff-role
 * floor so we never silently relax the check.
 */
async function assertReadAccess(
  collection: string,
  user: NxAuthUser | null,
  doc: Record<string, unknown> | null,
): Promise<void> {
  const config = getCollectionConfig(collection);
  if (!user) {
    throw new NxForbiddenError(collection, "read-revision");
  }

  if (config.access?.update) {
    const allowed = await config.access.update({ user, doc: doc ?? undefined });
    if (!allowed) {
      throw new NxForbiddenError(collection, "read-revision");
    }
    return;
  }

  // No update gate defined — require admin/editor (the staff roles that
  // can author content). `viewer`/`author` are stricter than `access
  // .read` would have been.
  if (user.role !== "admin" && user.role !== "editor") {
    throw new NxForbiddenError(collection, "read-revision");
  }
}

function toRevisionSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NxValidationError("Invalid revision snapshot", [
      { field: "snapshot", message: "Snapshot must be a JSON object" },
    ]);
  }

  return value as Record<string, unknown>;
}

export async function listRevisions(
  collection: string,
  documentId: string,
  options: NxRevisionListOptions = {},
  user: NxAuthUser | null = null,
): Promise<NxRevisionListResult> {
  assertVersionsEnabled(collection);
  // Load the doc so `access.update` (per #58) gets the actual row
  // instead of `null`. Collections that gate access by ownership /
  // category need the doc to make a sensible decision.
  const targetDoc = await getDocumentById(collection, documentId, user ?? undefined);
  await assertReadAccess(collection, user, targetDoc);

  const db = getDb() as unknown as DrizzleDb;
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);

  const filter = and(
    eq(nxRevisions.collection, collection),
    eq(nxRevisions.documentId, documentId),
  );

  const rows = (await db
    .select({
      id: nxRevisions.id,
      collection: nxRevisions.collection,
      documentId: nxRevisions.documentId,
      version: nxRevisions.version,
      status: nxRevisions.status,
      changedFields: nxRevisions.changedFields,
      authorId: nxRevisions.authorId,
      createdAt: nxRevisions.createdAt,
    })
    .from(nxRevisions)
    .where(filter)
    .orderBy(desc(nxRevisions.version))
    .limit(limit)
    .offset(offset)) as Array<{
    id: string;
    collection: string;
    documentId: string;
    version: number;
    status: NxRevisionStatus;
    changedFields: string[];
    authorId: string | null;
    createdAt: Date;
  }>;

  const [totalRow] = (await db
    .select({ total: count() })
    .from(nxRevisions)
    .where(filter)) as Array<{ total: number | string }>;

  return {
    revisions: rows.map((row) => ({
      ...row,
      changedFields: row.changedFields ?? [],
    })),
    total: Number(totalRow?.total ?? 0),
  };
}

export async function getRevision(
  collection: string,
  documentId: string,
  revisionId: string,
  user: NxAuthUser | null = null,
): Promise<NxRevision> {
  assertVersionsEnabled(collection);
  // Load the doc so `access.update` (per #58) gets the actual row.
  const targetDoc = await getDocumentById(collection, documentId, user ?? undefined);
  await assertReadAccess(collection, user, targetDoc);

  const db = getDb() as unknown as DrizzleDb;

  const [row] = (await db
    .select()
    .from(nxRevisions)
    .where(
      and(
        eq(nxRevisions.id, revisionId),
        eq(nxRevisions.collection, collection),
        eq(nxRevisions.documentId, documentId),
      ),
    )
    .limit(1)) as Array<{
    id: string;
    collection: string;
    documentId: string;
    version: number;
    status: NxRevisionStatus;
    changedFields: string[];
    snapshot: Record<string, unknown>;
    authorId: string | null;
    createdAt: Date;
  }>;

  if (!row) {
    throw new NxNotFoundError("revision", revisionId);
  }

  return {
    id: row.id,
    collection: row.collection,
    documentId: row.documentId,
    version: row.version,
    status: row.status,
    changedFields: row.changedFields ?? [],
    snapshot: toRevisionSnapshot(row.snapshot),
    authorId: row.authorId,
    createdAt: row.createdAt,
  };
}

export async function restoreRevision(
  collection: string,
  documentId: string,
  revisionId: string,
  user: NxAuthUser,
): Promise<NxSaveResult> {
  const revision = await getRevision(collection, documentId, revisionId, user);

  return saveDocument(collection, documentId, revision.snapshot, user, {
    status: revision.status === "published" ? "published" : "draft",
  });
}

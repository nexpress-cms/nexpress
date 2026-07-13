import { and, desc, eq, count } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { npRevisions } from "../db/schema/system.js";
import type { NpAuthUser, NpSaveResult } from "../config/types.js";
import { getCollectionConfig } from "./registry.js";
import { getDocumentById, saveDocument } from "./pipeline.js";
import { getDb } from "../db/runtime.js";
import {
  NpRevisionContractError,
  npAnalyzeRevision,
  npAnalyzeRevisionSummary,
  type NpRevision,
  type NpRevisionStatus,
  type NpRevisionSummary,
} from "../revisions/contract.js";

export type { NpRevision, NpRevisionStatus, NpRevisionSummary } from "../revisions/contract.js";

export interface NpRevisionListOptions {
  limit?: number;
  offset?: number;
}

export interface NpRevisionListResult {
  revisions: NpRevisionSummary[];
  total: number;
}

export type NpRevisionSnapshotValidator = (
  collection: string,
  snapshot: NpRevision["snapshot"],
) => void | Promise<void>;

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
    throw new NpValidationError("Revisions not enabled", [
      {
        field: "collection",
        message: `Collection "${collection}" has no versions config — configure versions to persist revisions.`,
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
  user: NpAuthUser | null,
  doc: Record<string, unknown> | null,
): Promise<void> {
  const config = getCollectionConfig(collection);
  if (!user) {
    throw new NpForbiddenError(collection, "read-revision");
  }

  if (config.access?.update) {
    const allowed = await config.access.update({ user, doc: doc ?? undefined });
    if (!allowed) {
      throw new NpForbiddenError(collection, "read-revision");
    }
    return;
  }

  // No update gate defined — require admin/editor (the staff roles that
  // can author content). `viewer`/`author` are stricter than `access
  // .read` would have been.
  if (user.role !== "admin" && user.role !== "editor") {
    throw new NpForbiddenError(collection, "read-revision");
  }
}

export async function listRevisions(
  collection: string,
  documentId: string,
  options: NpRevisionListOptions = {},
  user: NpAuthUser | null = null,
): Promise<NpRevisionListResult> {
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
    eq(npRevisions.collection, collection),
    eq(npRevisions.documentId, documentId),
  );

  const rows = (await db
    .select({
      id: npRevisions.id,
      collection: npRevisions.collection,
      documentId: npRevisions.documentId,
      version: npRevisions.version,
      status: npRevisions.status,
      changedFields: npRevisions.changedFields,
      authorId: npRevisions.authorId,
      createdAt: npRevisions.createdAt,
    })
    .from(npRevisions)
    .where(filter)
    .orderBy(desc(npRevisions.version))
    .limit(limit)
    .offset(offset)) as Array<{
    id: string;
    collection: string;
    documentId: string;
    version: number;
    status: NpRevisionStatus;
    changedFields: string[];
    authorId: string | null;
    createdAt: Date;
  }>;

  const [totalRow] = (await db
    .select({ total: count() })
    .from(npRevisions)
    .where(filter)) as Array<{ total: number | string }>;

  const revisions = rows.map((row) => {
    const result = npAnalyzeRevisionSummary(row);
    if (!result.ok) {
      throw new NpRevisionContractError("Invalid persisted revision summary", result.issues);
    }
    return result.value;
  });

  return {
    revisions,
    total: Number(totalRow?.total ?? 0),
  };
}

export async function getRevision(
  collection: string,
  documentId: string,
  revisionId: string,
  user: NpAuthUser | null = null,
): Promise<NpRevision> {
  assertVersionsEnabled(collection);
  // Load the doc so `access.update` (per #58) gets the actual row.
  const targetDoc = await getDocumentById(collection, documentId, user ?? undefined);
  await assertReadAccess(collection, user, targetDoc);

  const db = getDb() as unknown as DrizzleDb;

  const [row] = (await db
    .select()
    .from(npRevisions)
    .where(
      and(
        eq(npRevisions.id, revisionId),
        eq(npRevisions.collection, collection),
        eq(npRevisions.documentId, documentId),
      ),
    )
    .limit(1)) as Array<{
    id: string;
    collection: string;
    documentId: string;
    version: number;
    status: NpRevisionStatus;
    changedFields: string[];
    snapshot: unknown;
    authorId: string | null;
    createdAt: Date;
  }>;

  if (!row) {
    throw new NpNotFoundError("revision", revisionId);
  }

  const result = npAnalyzeRevision(row, getCollectionConfig(collection));
  if (!result.ok) {
    throw new NpRevisionContractError("Invalid persisted revision", result.issues);
  }
  return result.value;
}

export async function restoreRevision(
  collection: string,
  documentId: string,
  revisionId: string,
  user: NpAuthUser,
  validateSnapshot?: NpRevisionSnapshotValidator,
): Promise<NpSaveResult> {
  const revision = await getRevision(collection, documentId, revisionId, user);
  await validateSnapshot?.(collection, revision.snapshot);

  return saveDocument(collection, documentId, revision.snapshot, user, {
    status: revision.status === "published" ? "published" : "draft",
  });
}

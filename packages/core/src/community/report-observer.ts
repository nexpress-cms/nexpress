import { and, eq, getTableColumns, isNull } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  npGetPersistedCollectionDocumentById,
  type NpTransaction,
} from "../collections/pipeline.js";
import { getCollectionConfig, getCollectionTable } from "../collections/registry.js";
import { npRequireCommentRow, npRequireReportRow } from "../community-contract/contract.js";
import type { NpCommentRow, NpReportRow } from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npComments, npReports } from "../db/schema/community.js";
import { NpConflictError, NpNotFoundError } from "../errors.js";
import { npRequireReadableCommunityDocument } from "./audience.js";

type Db = ReturnType<typeof getDb>;
export interface NpCommunityCommentReportObservationV1 {
  db: Db;
  report: NpReportRow;
  comment: NpCommentRow;
}
/** Explicit host observation. Never dispatches events, starts Runtime or invokes a provider. */
export interface NpCommunityCommentReportObserverV1 {
  prepare(input: { db: Db; siteId: string }): Promise<void>;
  record(input: NpCommunityCommentReportObservationV1): Promise<void>;
}
let observer: NpCommunityCommentReportObserverV1 | null = null;
export function setCommunityCommentReportObserverV1(
  value: NpCommunityCommentReportObserverV1,
): void {
  if (typeof value?.prepare !== "function" || typeof value?.record !== "function")
    throw new Error("Invalid community comment report observer");
  observer = value;
}
export function resetCommunityCommentReportObserverV1(): void {
  observer = null;
}
/** Capture installation once. Prepare site control before parent/comment row locks. */
export async function npWriteObservedCommentReportV1(input: {
  siteId: string;
  targetType: string;
  targetId: string;
  reporterId: string;
  write: (db: Db) => Promise<NpReportRow>;
}): Promise<NpReportRow> {
  const installed = observer;
  if (!installed || input.targetType !== "comment") return input.write(getDb());
  return getDb().transaction(async (transaction) => {
    const db = transaction as Db;
    await installed.prepare({ db, siteId: input.siteId });
    // Reject duplicates without locking a report ahead of its parent. Recheck
    // after the target locks to avoid waiting on the partial unique index.
    async function rejectDuplicate(): Promise<void> {
      const [existing] = await db
        .select({ id: npReports.id })
        .from(npReports)
        .where(
          and(
            eq(npReports.siteId, input.siteId),
            eq(npReports.reporterId, input.reporterId),
            eq(npReports.targetType, "comment"),
            eq(npReports.targetId, input.targetId),
            isNull(npReports.resolvedAt),
          ),
        )
        .limit(1);
      if (existing)
        throw new NpConflictError("You already have an unresolved report for this target.");
    }
    await rejectDuplicate();
    const [initial] = await db
      .select()
      .from(npComments)
      .where(and(eq(npComments.siteId, input.siteId), eq(npComments.id, input.targetId)))
      .limit(1);
    if (!initial) throw new NpNotFoundError("comment", input.targetId);
    const config = getCollectionConfig(initial.targetType);
    const columns = getTableColumns(getCollectionTable(initial.targetType) as PgTable);
    if (!columns.id || !columns.siteId) throw new NpNotFoundError("comment", input.targetId);
    await db
      .select({ id: columns.id })
      .from(getCollectionTable(initial.targetType) as PgTable)
      .where(and(eq(columns.id, initial.targetId), eq(columns.siteId, input.siteId)))
      .limit(1)
      .for("update");
    const [locked] = await db
      .select()
      .from(npComments)
      .where(and(eq(npComments.siteId, input.siteId), eq(npComments.id, input.targetId)))
      .limit(1)
      .for("update");
    if (
      !locked ||
      locked.status !== "visible" ||
      locked.targetType !== initial.targetType ||
      locked.targetId !== initial.targetId
    )
      throw new NpNotFoundError("comment", input.targetId);
    const comment = npRequireCommentRow(locked);
    const parent = await npGetPersistedCollectionDocumentById(
      comment.targetType,
      comment.targetId,
      input.siteId,
      { tx: transaction as unknown as NpTransaction },
    );
    if (!parent) throw new NpNotFoundError("comment", input.targetId);
    await npRequireReadableCommunityDocument(config, parent, {
      kind: "member",
      memberId: input.reporterId,
    });
    await rejectDuplicate();
    const report = npRequireReportRow(await input.write(db));
    if (
      report.siteId !== input.siteId ||
      report.targetType !== "comment" ||
      report.targetId !== comment.id ||
      report.reporterId !== input.reporterId
    )
      throw new Error("Comment report observation binding mismatch");
    await installed.record({ db, report, comment });
    return report;
  });
}

import { and, eq, getTableColumns, isNull } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  npGetPersistedCollectionDocumentById,
  type NpTransaction,
} from "../collections/pipeline.js";
import { getCollectionConfig, getCollectionTable } from "../collections/registry.js";
import { npRequireReportRow } from "../community-contract/contract.js";
import type { NpReportRow } from "../community-contract/types.js";
import type { NpCollectionConfig } from "../config/types.js";
import { getDb } from "../db/runtime.js";
import { npReports } from "../db/schema/community.js";
import { NpConflictError, NpNotFoundError } from "../errors.js";
import { npRequireReadableCommunityDocument } from "./audience.js";

type Db = ReturnType<typeof getDb>;
export interface NpCommunityDocumentReportObservationV1 {
  db: Db;
  report: NpReportRow;
  document: Record<string, unknown>;
  config: NpCollectionConfig;
}
/** Explicit host observation. Never dispatches events, starts Runtime or invokes a provider. */
export interface NpCommunityDocumentReportObserverV1 {
  prepare(input: { db: Db; siteId: string }): Promise<void>;
  record(input: NpCommunityDocumentReportObservationV1): Promise<void>;
}
let observer: NpCommunityDocumentReportObserverV1 | null = null;
export function setCommunityDocumentReportObserverV1(
  value: NpCommunityDocumentReportObserverV1,
): void {
  if (typeof value?.prepare !== "function" || typeof value?.record !== "function")
    throw new Error("Invalid community document report observer");
  observer = value;
}
export function resetCommunityDocumentReportObserverV1(): void {
  observer = null;
}
/** Capture installation once. Prepare site control before the document row lock. */
export async function npWriteObservedDocumentReportV1(input: {
  siteId: string;
  targetType: string;
  targetId: string;
  reporterId: string;
  write: (db: Db) => Promise<NpReportRow>;
}): Promise<NpReportRow> {
  const installed = observer;
  if (!installed || input.targetType === "comment" || input.targetType === "member")
    return input.write(getDb());
  const config = getCollectionConfig(input.targetType);
  if (!config.community?.moderation || config.community.reports !== true)
    return input.write(getDb());
  const hiddenField = config.community.moderation.hiddenField;
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
            eq(npReports.targetType, input.targetType),
            eq(npReports.targetId, input.targetId),
            isNull(npReports.resolvedAt),
          ),
        )
        .limit(1);
      if (existing)
        throw new NpConflictError("You already have an unresolved report for this target.");
    }
    await rejectDuplicate();
    const table = getCollectionTable(input.targetType) as PgTable;
    const columns = getTableColumns(table);
    if (!columns.id || !columns.siteId) throw new NpNotFoundError(input.targetType, input.targetId);
    await db
      .select({ id: columns.id })
      .from(table)
      .where(and(eq(columns.id, input.targetId), eq(columns.siteId, input.siteId)))
      .limit(1)
      .for("update");
    const document = await npGetPersistedCollectionDocumentById(
      input.targetType,
      input.targetId,
      input.siteId,
      { tx: transaction as unknown as NpTransaction },
    );
    if (
      !document ||
      document.status !== "published" ||
      document.visibility !== "public" ||
      document[hiddenField] !== false
    )
      throw new NpNotFoundError(input.targetType, input.targetId);
    await npRequireReadableCommunityDocument(config, document, {
      kind: "member",
      memberId: input.reporterId,
    });
    await rejectDuplicate();
    const report = npRequireReportRow(await input.write(db));
    if (
      report.siteId !== input.siteId ||
      report.targetType !== input.targetType ||
      report.targetId !== input.targetId ||
      report.reporterId !== input.reporterId
    )
      throw new Error("Document report observation binding mismatch");
    await installed.record({ db, report, document, config });
    return report;
  });
}

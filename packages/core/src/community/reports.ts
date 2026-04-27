import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";

import {
  getCollectionRegistration,
  getCollectionTable,
} from "../collections/registry.js";
import { getDb } from "../collections/pipeline.js";
import { nxComments, nxMembers, nxReports } from "../db/schema/community.js";
import { NxNotFoundError, NxValidationError } from "../errors.js";

import { recordAuditEvent } from "./audit.js";
import { assertNotBanned } from "./can.js";
import type { Principal } from "./principal.js";

const MAX_REASON_LENGTH = 1000;
const SUPPORTED_TARGETS = ["comment", "thread", "reply", "member"] as const;
type ReportTarget = (typeof SUPPORTED_TARGETS)[number];

export interface NxReportRow {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolvedByMemberId: string | null;
  resolution: string | null;
  createdAt: Date;
}

export interface FileReportInput {
  reporterId: string;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
}

function validateTargetType(value: string): asserts value is ReportTarget {
  if (!(SUPPORTED_TARGETS as readonly string[]).includes(value)) {
    throw new NxValidationError("Invalid input", [
      {
        field: "targetType",
        message: `targetType must be one of: ${SUPPORTED_TARGETS.join(", ")}`,
      },
    ]);
  }
}

/**
 * Members file reports against a piece of community content. The
 * reason is free-form; mods triage it via `listReports` and
 * `resolveReport`.
 */
export async function fileReport(input: FileReportInput): Promise<NxReportRow> {
  validateTargetType(input.targetType);
  const targetId = input.targetId.trim();
  if (targetId.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "targetId", message: "targetId required" },
    ]);
  }
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "reason", message: "Report reason required" },
    ]);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new NxValidationError("Invalid input", [
      { field: "reason", message: `Reason must be ≤ ${MAX_REASON_LENGTH} characters` },
    ]);
  }

  // Banned members can't file reports — site-wide bans block every
  // community write, including the report queue (#53). We don't have
  // an obvious scope chain for a polymorphic report target, so just
  // check site-wide.
  await assertNotBanned(input.reporterId);

  // Verify the target actually exists. Without this, members can fill
  // the moderation queue with reports against UUIDs that point at
  // nothing — and the audit log captures the phantom target id too,
  // making forensic review noisy. (#52)
  await assertReportTargetExists(input.targetType, targetId);

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .insert(nxReports)
    .values({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId,
      reason,
    })
    .returning()) as NxReportRow[];
  if (!row) throw new Error("Report insert returned no row");

  await recordAuditEvent({
    actor: { kind: "member", memberId: input.reporterId },
    action: "report.filed",
    targetType: input.targetType,
    targetId,
    payload: { reportId: row.id, reason },
  });

  return row;
}

export interface ListReportsOptions {
  /** Default: only unresolved. Pass `"all"` to include resolved. */
  status?: "unresolved" | "resolved" | "all";
  /** Filter to a specific target type. */
  targetType?: string;
  limit?: number;
  offset?: number;
}

export interface ListReportsResult {
  reports: NxReportRow[];
  totalDocs: number;
}

export async function listReports(
  options: ListReportsOptions = {},
): Promise<ListReportsResult> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters = [];
  if (options.status === "resolved") filters.push(isNotNull(nxReports.resolvedAt));
  else if (options.status === "all") {
    /* no-op */
  } else filters.push(isNull(nxReports.resolvedAt));
  if (options.targetType) filters.push(eq(nxReports.targetType, options.targetType));

  const where = filters.length > 0 ? and(...filters) : undefined;

  const reports = (await db
    .select()
    .from(nxReports)
    .where(where)
    .orderBy(desc(nxReports.createdAt))
    .limit(limit)
    .offset(offset)) as NxReportRow[];

  const [totalRow] = (await db
    .select({ total: count() })
    .from(nxReports)
    .where(where)) as Array<{ total: number }>;

  return { reports, totalDocs: Number(totalRow?.total ?? 0) };
}

export interface ResolveReportInput {
  reportId: string;
  /** Free-form short label: e.g. `"hidden"`, `"banned"`, `"dismissed"`. */
  resolution: string;
  actor: Principal;
}

/**
 * Marks a report resolved. Caller is responsible for taking the
 * actual moderation action (hide, ban, etc.) — this only flips the
 * report row and writes an audit entry.
 */
export async function resolveReport(input: ResolveReportInput): Promise<NxReportRow> {
  const resolution = input.resolution.trim();
  if (resolution.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "resolution", message: "Resolution label required" },
    ]);
  }

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select()
    .from(nxReports)
    .where(eq(nxReports.id, input.reportId))
    .limit(1)) as NxReportRow[];
  if (!existing) throw new NxNotFoundError("report", input.reportId);
  if (existing.resolvedAt) {
    throw new NxValidationError("Invalid state", [
      { field: "report", message: "Report already resolved" },
    ]);
  }

  const resolvedByUserId = input.actor.kind === "staff" ? input.actor.user.id : null;
  const resolvedByMemberId = input.actor.kind === "member" ? input.actor.memberId : null;

  const [updated] = (await db
    .update(nxReports)
    .set({
      resolvedAt: new Date(),
      resolvedByUserId,
      resolvedByMemberId,
      resolution,
    })
    .where(eq(nxReports.id, input.reportId))
    .returning()) as NxReportRow[];
  if (!updated) throw new Error("Report update returned no row");

  await recordAuditEvent({
    actor:
      input.actor.kind === "staff"
        ? { kind: "staff", userId: input.actor.user.id }
        : { kind: "member", memberId: input.actor.memberId },
    action: "report.resolved",
    targetType: existing.targetType,
    targetId: existing.targetId,
    payload: { reportId: existing.id, resolution },
  });

  return updated;
}

/**
 * Verify the report's target row actually exists.
 *
 *   - `comment` / `reply` — both stored in `nx_comments`
 *     (the forum plugin's replies are just comments under
 *     a discussion thread). Lookup the comment row.
 *   - `member` — direct lookup against `nx_members`.
 *   - `thread` — Phase 9.9 enabled. The forum plugin
 *     stores threads as rows in the `discussions` collection
 *     (Phase 9.4 decision: no thread-specific tables, reuse
 *     the codegen pipeline). We resolve the table at runtime
 *     so the report flow works whether the discussions
 *     collection is named `discussions`, `posts`, or anything
 *     else — sites that register a different forum slug just
 *     pass that through as `targetType`. Falls back to a
 *     clear "no such collection" error when unregistered.
 */
async function assertReportTargetExists(
  targetType: string,
  targetId: string,
): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  if (targetType === "comment" || targetType === "reply") {
    const [row] = (await db
      .select({ id: nxComments.id })
      .from(nxComments)
      .where(eq(nxComments.id, targetId))
      .limit(1)) as Array<{ id: string }>;
    if (!row) throw new NxNotFoundError(targetType, targetId);
    return;
  }
  if (targetType === "member") {
    const [row] = (await db
      .select({ id: nxMembers.id })
      .from(nxMembers)
      .where(eq(nxMembers.id, targetId))
      .limit(1)) as Array<{ id: string }>;
    if (!row) throw new NxNotFoundError("member", targetId);
    return;
  }
  if (targetType === "thread") {
    // Resolve to a registered collection that opts in to
    // member-write thread semantics. We try `discussions`
    // first (the forum plugin's default slug); future
    // multi-forum setups can register different slugs and
    // the plugin's report-emission path can supply them.
    const slug = "discussions";
    let registered: ReturnType<typeof getCollectionRegistration> | null;
    try {
      registered = getCollectionRegistration(slug);
    } catch {
      registered = null;
    }
    if (!registered) {
      throw new NxValidationError("Invalid input", [
        {
          field: "targetType",
          message:
            "Reports against threads require the forum plugin's `discussions` collection to be registered.",
        },
      ]);
    }
    const table = getCollectionTable(slug) as PgTable;
    const idCol = (table as unknown as Record<string, unknown>).id;
    const [row] = (await db
      .select({ id: idCol as never })
      .from(table)
      .where(eq(idCol as never, targetId))
      .limit(1)) as Array<{ id: string }>;
    if (!row) throw new NxNotFoundError("thread", targetId);
    return;
  }
  throw new NxValidationError("Invalid input", [
    {
      field: "targetType",
      message: `Reports against "${targetType}" are not supported`,
    },
  ]);
}

/** Cheap "is anything in the queue?" probe for the admin badge. */
export async function unresolvedReportCount(): Promise<number> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ total: count() })
    .from(nxReports)
    .where(isNull(nxReports.resolvedAt))) as Array<{ total: number }>;
  return Number(row?.total ?? 0);
}

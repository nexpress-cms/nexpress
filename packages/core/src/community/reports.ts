import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxReports } from "../db/schema/community.js";
import { NxNotFoundError, NxValidationError } from "../errors.js";

import { recordAuditEvent } from "./audit.js";
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

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .insert(nxReports)
    .values({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason,
    })
    .returning()) as NxReportRow[];
  if (!row) throw new Error("Report insert returned no row");

  await recordAuditEvent({
    actor: { kind: "member", memberId: input.reporterId },
    action: "report.filed",
    targetType: input.targetType,
    targetId: input.targetId,
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

  // Cheap total — re-run the where without limit/offset.
  const all = (await db.select({ id: nxReports.id }).from(nxReports).where(where)) as Array<{
    id: string;
  }>;

  return { reports, totalDocs: all.length };
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

/** Cheap "is anything in the queue?" probe for the admin badge. */
export async function unresolvedReportCount(): Promise<number> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const all = (await db
    .select({ id: nxReports.id })
    .from(nxReports)
    .where(isNull(nxReports.resolvedAt))) as Array<{ id: string }>;
  return all.length;
}

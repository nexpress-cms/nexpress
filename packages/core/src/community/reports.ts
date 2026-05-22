import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { getCollectionRegistration, getCollectionTable } from "../collections/registry.js";
import { getDb } from "../db/runtime.js";
import { npComments, npMembers, npReports } from "../db/schema/community.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

import { recordAuditEvent } from "./audit.js";
import { withMemberWrite } from "./can.js";
import type { Principal } from "./principal.js";

const MAX_REASON_LENGTH = 1000;
const SUPPORTED_TARGETS = ["comment", "thread", "reply", "member"] as const;
type ReportTarget = (typeof SUPPORTED_TARGETS)[number];

export interface NpReportRow {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolvedByMemberId: string | null;
  resolution: string | null;
  siteId: string;
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
    throw new NpValidationError("Invalid input", [
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
export async function fileReport(input: FileReportInput): Promise<NpReportRow> {
  validateTargetType(input.targetType);
  const targetId = input.targetId.trim();
  if (targetId.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "targetId", message: "targetId required" },
    ]);
  }
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "reason", message: "Report reason required" },
    ]);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new NpValidationError("Invalid input", [
      { field: "reason", message: `Reason must be ≤ ${MAX_REASON_LENGTH} characters` },
    ]);
  }

  // #311 — withMemberWrite enforces the ban gate by structure.
  // Site-wide bans block every community write including reports
  // (#53); no obvious scope chain for a polymorphic report target.
  return withMemberWrite(input.reporterId, [], async () => {
    return doFileReport(input, targetId, reason);
  });
}

async function doFileReport(
  input: FileReportInput,
  targetId: string,
  reason: string,
): Promise<NpReportRow> {
  // Verify the target actually exists. Without this, members can fill
  // the moderation queue with reports against UUIDs that point at
  // nothing — and the audit log captures the phantom target id too,
  // making forensic review noisy. (#52)
  //
  // Issue #215 — `assertReportTargetExists` now also returns the
  // target's canonical site so we can reject cross-tenant reports.
  // A member on site A who guessed at a comment id on site B
  // shouldn't be able to file a report under either tenant — this
  // path stays single-tenant.
  const target = await assertReportTargetExists(input.targetType, targetId);

  const db = getDb();
  // Phase 18 — file the report under the current tenant so the
  // mod queue surfaces it on the right site.
  // #272 — write: must NOT silently fall through; a misfiled
  // report would surface in the wrong moderator's queue.
  const siteId = await requireSiteId();
  if (target.siteId !== null && target.siteId !== siteId) {
    throw new NpForbiddenError("report", "cross-site");
  }
  const [row] = (await db
    .insert(npReports)
    .values({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId,
      reason,
      siteId,
    })
    .returning()) as NpReportRow[];
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
  /**
   * Phase 18 — site scope. `undefined` (default) → use the
   * request resolver's site. Pass an explicit string to view
   * another tenant's queue (super-admin) or `null` to skip
   * the filter entirely.
   */
  siteId?: string | null;
  limit?: number;
  offset?: number;
}

export interface ListReportsResult {
  reports: NpReportRow[];
  totalDocs: number;
}

export async function listReports(options: ListReportsOptions = {}): Promise<ListReportsResult> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters = [];
  if (options.status === "resolved") filters.push(isNotNull(npReports.resolvedAt));
  else if (options.status === "all") {
    /* no-op */
  } else filters.push(isNull(npReports.resolvedAt));
  if (options.targetType) filters.push(eq(npReports.targetType, options.targetType));

  // Phase 18 — scope to current tenant so mods on tenant A
  // don't see tenant B's queue. Pass `siteId: null` to skip
  // (super-admin cross-tenant triage); otherwise use the
  // resolver. Mirrors the pattern from Phase 17 audit.
  if (options.siteId !== null) {
    const resolvedSite = options.siteId !== undefined ? options.siteId : await getCurrentSiteId();
    if (resolvedSite !== null) {
      filters.push(eq(npReports.siteId, resolvedSite));
    }
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const reports = (await db
    .select()
    .from(npReports)
    .where(where)
    .orderBy(desc(npReports.createdAt))
    .limit(limit)
    .offset(offset)) as NpReportRow[];

  const [totalRow] = (await db.select({ total: count() }).from(npReports).where(where)) as Array<{
    total: number;
  }>;

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
export async function resolveReport(input: ResolveReportInput): Promise<NpReportRow> {
  const resolution = input.resolution.trim();
  if (resolution.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "resolution", message: "Resolution label required" },
    ]);
  }

  const db = getDb();
  // Issue #363 — `listReports` was already site-scoped, but
  // `resolveReport` fetched and updated by id only. A moderator who
  // obtained a foreign report id (e.g. from logs of a tenant they
  // also belong to, or by guessing) could mark it resolved and
  // write the audit event in their own request context. Fix:
  // require the request site, reject when the loaded row's siteId
  // diverges, AND include `siteId` in the update predicate so the
  // read-check and the write cannot drift.
  const requestSiteId = await requireSiteId();
  const [existing] = (await db
    .select()
    .from(npReports)
    .where(eq(npReports.id, input.reportId))
    .limit(1)) as NpReportRow[];
  if (!existing) throw new NpNotFoundError("report", input.reportId);
  if (existing.siteId !== requestSiteId) {
    throw new NpForbiddenError("report", "cross-site");
  }
  if (existing.resolvedAt) {
    throw new NpValidationError("Invalid state", [
      { field: "report", message: "Report already resolved" },
    ]);
  }

  const resolvedByUserId = input.actor.kind === "staff" ? input.actor.user.id : null;
  const resolvedByMemberId = input.actor.kind === "member" ? input.actor.memberId : null;

  const [updated] = (await db
    .update(npReports)
    .set({
      resolvedAt: new Date(),
      resolvedByUserId,
      resolvedByMemberId,
      resolution,
    })
    .where(and(eq(npReports.id, input.reportId), eq(npReports.siteId, requestSiteId)))
    .returning()) as NpReportRow[];
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
 *   - `comment` / `reply` — both stored in `np_comments`
 *     (the forum plugin's replies are just comments under
 *     a discussion thread). Lookup the comment row.
 *   - `member` — direct lookup against `np_members`.
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
/**
 * Issue #215 — verify the target exists AND surface its canonical
 * site id so the caller can reject cross-tenant report attempts.
 * Returns the target's `siteId` (or `null` for `member` targets,
 * which aren't site-scoped today). The site comparison happens at
 * the call site so the error message stays specific to "reports".
 */
async function assertReportTargetExists(
  targetType: string,
  targetId: string,
): Promise<{ siteId: string | null }> {
  const db = getDb();
  if (targetType === "comment" || targetType === "reply") {
    const [row] = (await db
      .select({ id: npComments.id, siteId: npComments.siteId })
      .from(npComments)
      .where(eq(npComments.id, targetId))
      .limit(1)) as Array<{ id: string; siteId: string }>;
    if (!row) throw new NpNotFoundError(targetType, targetId);
    return { siteId: row.siteId };
  }
  if (targetType === "member") {
    const [row] = (await db
      .select({ id: npMembers.id })
      .from(npMembers)
      .where(eq(npMembers.id, targetId))
      .limit(1)) as Array<{ id: string }>;
    if (!row) throw new NpNotFoundError("member", targetId);
    // Members aren't site-scoped (one np_members row can have
    // memberships across sites); skip the cross-site check.
    return { siteId: null };
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
      throw new NpValidationError("Invalid input", [
        {
          field: "targetType",
          message:
            "Reports against threads require the forum plugin's `discussions` collection to be registered.",
        },
      ]);
    }
    const table = getCollectionTable(slug) as PgTable;
    const idCol = (table as unknown as Record<string, unknown>).id;
    const siteCol = (table as unknown as Record<string, unknown>).siteId;
    const [row] = (await db
      .select({ id: idCol as never, siteId: siteCol as never })
      .from(table)
      .where(eq(idCol as never, targetId))
      .limit(1)) as Array<{ id: string; siteId: string | null }>;
    if (!row) throw new NpNotFoundError("thread", targetId);
    return { siteId: row.siteId ?? null };
  }
  throw new NpValidationError("Invalid input", [
    {
      field: "targetType",
      message: `Reports against "${targetType}" are not supported`,
    },
  ]);
}

/** Cheap "is anything in the queue?" probe for the admin badge. */
export async function unresolvedReportCount(): Promise<number> {
  const db = getDb();
  // Phase 18 — count only the current tenant's queue.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const [row] = (await db
    .select({ total: count() })
    .from(npReports)
    .where(and(eq(npReports.siteId, siteId), isNull(npReports.resolvedAt)))) as Array<{
    total: number;
  }>;
  return Number(row?.total ?? 0);
}

import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";

import { getCollectionRegistration, getCollectionTable } from "../collections/registry.js";
import { getDb } from "../collections/pipeline.js";
import { nxComments, nxMembers, nxReports } from "../db/schema/community.js";
import { NxForbiddenError, NxNotFoundError, NxValidationError } from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";

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
  //
  // Issue #215 — `assertReportTargetExists` now also returns the
  // target's canonical site so we can reject cross-tenant reports.
  // A member on site A who guessed at a comment id on site B
  // shouldn't be able to file a report under either tenant — this
  // path stays single-tenant.
  const target = await assertReportTargetExists(input.targetType, targetId);

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  // Phase 18 — file the report under the current tenant so the
  // mod queue surfaces it on the right site.
  // #272 — write: must NOT silently fall through; a misfiled
  // report would surface in the wrong moderator's queue.
  const siteId = await requireSiteId();
  if (target.siteId !== null && target.siteId !== siteId) {
    throw new NxForbiddenError("report", "cross-site");
  }
  const [row] = (await db
    .insert(nxReports)
    .values({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId,
      reason,
      siteId,
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
  reports: NxReportRow[];
  totalDocs: number;
}

export async function listReports(options: ListReportsOptions = {}): Promise<ListReportsResult> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters = [];
  if (options.status === "resolved") filters.push(isNotNull(nxReports.resolvedAt));
  else if (options.status === "all") {
    /* no-op */
  } else filters.push(isNull(nxReports.resolvedAt));
  if (options.targetType) filters.push(eq(nxReports.targetType, options.targetType));

  // Phase 18 — scope to current tenant so mods on tenant A
  // don't see tenant B's queue. Pass `siteId: null` to skip
  // (super-admin cross-tenant triage); otherwise use the
  // resolver. Mirrors the pattern from Phase 17 audit.
  if (options.siteId !== null) {
    const resolvedSite = options.siteId !== undefined ? options.siteId : await getCurrentSiteId();
    if (resolvedSite !== null) {
      filters.push(eq(nxReports.siteId, resolvedSite));
    }
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const reports = (await db
    .select()
    .from(nxReports)
    .where(where)
    .orderBy(desc(nxReports.createdAt))
    .limit(limit)
    .offset(offset)) as NxReportRow[];

  const [totalRow] = (await db.select({ total: count() }).from(nxReports).where(where)) as Array<{
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  if (targetType === "comment" || targetType === "reply") {
    const [row] = (await db
      .select({ id: nxComments.id, siteId: nxComments.siteId })
      .from(nxComments)
      .where(eq(nxComments.id, targetId))
      .limit(1)) as Array<{ id: string; siteId: string }>;
    if (!row) throw new NxNotFoundError(targetType, targetId);
    return { siteId: row.siteId };
  }
  if (targetType === "member") {
    const [row] = (await db
      .select({ id: nxMembers.id })
      .from(nxMembers)
      .where(eq(nxMembers.id, targetId))
      .limit(1)) as Array<{ id: string }>;
    if (!row) throw new NxNotFoundError("member", targetId);
    // Members aren't site-scoped (one nx_members row can have
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
    const siteCol = (table as unknown as Record<string, unknown>).siteId;
    const [row] = (await db
      .select({ id: idCol as never, siteId: siteCol as never })
      .from(table)
      .where(eq(idCol as never, targetId))
      .limit(1)) as Array<{ id: string; siteId: string | null }>;
    if (!row) throw new NxNotFoundError("thread", targetId);
    return { siteId: row.siteId ?? null };
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
  // Phase 18 — count only the current tenant's queue.
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const [row] = (await db
    .select({ total: count() })
    .from(nxReports)
    .where(and(eq(nxReports.siteId, siteId), isNull(nxReports.resolvedAt)))) as Array<{
    total: number;
  }>;
  return Number(row?.total ?? 0);
}

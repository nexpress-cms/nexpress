import { and, count, desc, eq, gte, lt } from "drizzle-orm";

import {
  npRequireAuditEventRow,
  npRequireRecordAuditEventInput,
} from "../community-contract/contract.js";
import type {
  AuditActor,
  AuditActorKind,
  AuditEventRow,
  RecordAuditEventInput,
} from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npAuditEvents } from "../db/schema/community.js";
import { getLogger } from "../observability/logger.js";
import { getCurrentSiteId } from "../sites/context.js";

/**
 * Append-only moderation audit log. Every hide / restore / ban /
 * role-grant write goes through here so admins can later answer
 * "who took this action and when?" without diffing application logs.
 *
 * Writes are best-effort: a failed audit insert MUST NOT prevent the
 * underlying mod action from succeeding (logged via the observability
 * hooks instead). Reads are paginated and indexed by target.
 */

export type { AuditActor, AuditActorKind, AuditEventRow, RecordAuditEventInput };

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  const db = getDb();
  try {
    const checked = npRequireRecordAuditEventInput(input);
    // Phase 17 — fill `site_id` from the request resolver when
    // the caller doesn't pin it explicitly. Resolver returns
    // null in non-request contexts (jobs, scripts), which we
    // record as a NULL site so super-admin queries can find
    // them via "no site filter."
    const siteId = checked.siteId === undefined ? await getCurrentSiteId() : checked.siteId;
    await db.insert(npAuditEvents).values({
      actorKind: checked.actor.kind,
      actorUserId: checked.actor.kind === "staff" ? checked.actor.userId : null,
      actorMemberId: checked.actor.kind === "member" ? checked.actor.memberId : null,
      action: checked.action,
      targetType: checked.targetType ?? null,
      targetId: checked.targetId ?? null,
      payload: checked.payload ?? {},
      siteId,
    });
  } catch (err) {
    // Audit failures must not block the underlying mod action — but
    // they MUST surface, otherwise gaps in the forensic record go
    // unnoticed (column drift, FK violation, transient pg blip).
    getLogger().error("audit insert failed", {
      error: err instanceof Error ? err.message : String(err),
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
    });
  }
}

export interface ListAuditOptions {
  /** Filter to audit events targeting one specific row. */
  targetType?: string;
  targetId?: string;
  /** Filter to events caused by a specific actor. */
  actorUserId?: string;
  actorMemberId?: string;
  /**
   * Filter to events whose `action` matches. Common operational
   * query: "show every ban issued this week" →
   * `action="member.ban.issue"` plus `since`.
   */
  action?: string;
  /** Lower-bound `created_at` (inclusive). */
  since?: Date;
  /** Upper-bound `created_at` (exclusive). */
  until?: Date;
  /**
   * Phase 17 — site filter. `undefined` means "use current
   * request's site" (the typical admin-page query). Pass an
   * explicit string to view another site's audit log
   * (super-admin cross-site triage). Pass `null` to skip the
   * filter entirely (every site's events).
   */
  siteId?: string | null;
  limit?: number;
  offset?: number;
}

export async function listAuditEvents(
  options: ListAuditOptions = {},
): Promise<{ events: AuditEventRow[]; totalDocs: number }> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters = [];
  if (options.targetType) filters.push(eq(npAuditEvents.targetType, options.targetType));
  if (options.targetId) filters.push(eq(npAuditEvents.targetId, options.targetId));
  if (options.actorUserId) filters.push(eq(npAuditEvents.actorUserId, options.actorUserId));
  if (options.actorMemberId) filters.push(eq(npAuditEvents.actorMemberId, options.actorMemberId));
  if (options.action) filters.push(eq(npAuditEvents.action, options.action));
  if (options.since) filters.push(gte(npAuditEvents.createdAt, options.since));
  if (options.until) filters.push(lt(npAuditEvents.createdAt, options.until));

  // Phase 17 — site scope.
  // `undefined` (default) → use the resolver's current site if
  //                        any. Pass `null` to skip filtering
  //                        (cross-site, super-admin).
  if (options.siteId !== null) {
    const resolvedSite = options.siteId !== undefined ? options.siteId : await getCurrentSiteId();
    if (resolvedSite !== null) {
      filters.push(eq(npAuditEvents.siteId, resolvedSite));
    }
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = (await db
    .select()
    .from(npAuditEvents)
    .where(where)
    .orderBy(desc(npAuditEvents.createdAt))
    .limit(limit)
    .offset(offset)) as AuditEventRow[];

  const [totalRow] = (await db
    .select({ total: count() })
    .from(npAuditEvents)
    .where(where)) as Array<{ total: number }>;
  const totalDocs = Number(totalRow?.total ?? 0);
  return { events: rows.map(npRequireAuditEventRow), totalDocs };
}

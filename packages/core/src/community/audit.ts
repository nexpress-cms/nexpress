import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { nxAuditEvents } from "../db/schema/community.js";
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

export type AuditActorKind = "staff" | "member" | "system";

export interface AuditActor {
  kind: AuditActorKind;
  /** Set only for `kind: "staff"`. */
  userId?: string;
  /** Set only for `kind: "member"`. */
  memberId?: string;
}

export interface RecordAuditEventInput {
  actor: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
  /**
   * Phase 17 — site this event belongs to. When omitted the
   * writer reads `getCurrentSiteId()` so request-driven calls
   * automatically scope to the resolving tenant. Pass `null`
   * explicitly to record an unscoped event (super-admin
   * cross-site action, background job).
   */
  siteId?: string | null;
}

export interface AuditEventRow {
  id: string;
  actorKind: AuditActorKind;
  actorUserId: string | null;
  actorMemberId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  siteId: string | null;
  createdAt: Date;
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  try {
    // Phase 17 — fill `site_id` from the request resolver when
    // the caller doesn't pin it explicitly. Resolver returns
    // null in non-request contexts (jobs, scripts), which we
    // record as a NULL site so super-admin queries can find
    // them via "no site filter."
    const siteId = input.siteId === undefined ? await getCurrentSiteId() : input.siteId;
    await db.insert(nxAuditEvents).values({
      actorKind: input.actor.kind,
      actorUserId: input.actor.userId ?? null,
      actorMemberId: input.actor.memberId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      payload: input.payload ?? {},
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters = [];
  if (options.targetType) filters.push(eq(nxAuditEvents.targetType, options.targetType));
  if (options.targetId) filters.push(eq(nxAuditEvents.targetId, options.targetId));
  if (options.actorUserId) filters.push(eq(nxAuditEvents.actorUserId, options.actorUserId));
  if (options.actorMemberId) filters.push(eq(nxAuditEvents.actorMemberId, options.actorMemberId));
  if (options.action) filters.push(eq(nxAuditEvents.action, options.action));
  if (options.since) filters.push(gte(nxAuditEvents.createdAt, options.since));
  if (options.until) filters.push(lt(nxAuditEvents.createdAt, options.until));

  // Phase 17 — site scope.
  // `undefined` (default) → use the resolver's current site if
  //                        any. Pass `null` to skip filtering
  //                        (cross-site, super-admin).
  if (options.siteId !== null) {
    const resolvedSite = options.siteId !== undefined ? options.siteId : await getCurrentSiteId();
    if (resolvedSite !== null) {
      filters.push(eq(nxAuditEvents.siteId, resolvedSite));
    }
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = (await db
    .select()
    .from(nxAuditEvents)
    .where(where)
    .orderBy(desc(nxAuditEvents.createdAt))
    .limit(limit)
    .offset(offset)) as AuditEventRow[];

  const [totalRow] = (await db
    .select({ total: count() })
    .from(nxAuditEvents)
    .where(where)) as Array<{ total: number }>;
  const totalDocs = Number(totalRow?.total ?? 0);
  return { events: rows, totalDocs };
}

import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxAuditEvents } from "../db/schema/community.js";
import { getLogger } from "../observability/logger.js";

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
  createdAt: Date;
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  try {
    await db.insert(nxAuditEvents).values({
      actorKind: input.actor.kind,
      actorUserId: input.actor.userId ?? null,
      actorMemberId: input.actor.memberId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      payload: input.payload ?? {},
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

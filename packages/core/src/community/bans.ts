import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { npBans } from "../db/schema/community.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";

import { recordAuditEvent } from "./audit.js";
import type { Principal } from "./principal.js";

/**
 * Ban service. The 9.1a schema already had `nx_bans`; this layer
 * adds the issue / list / revoke flow plus audit logging.
 *
 * Scope rules in v1:
 *  - `site` — issuer must be staff (admin / editor / moderator).
 *  - `category`, `collection` — issuer must be a community-mod or
 *    a staff mod. We don't currently verify the issuer holds the
 *    matching scoped grant; the API layer is responsible for that
 *    check via `principalCan` before calling `issueBan`. The audit
 *    log records the issuer either way for forensic review.
 */

export type BanScope = "site" | "category" | "collection";
export type BanKind = "temporary" | "permanent";

export interface NpBanRow {
  id: string;
  memberId: string;
  scopeType: BanScope;
  scopeId: string | null;
  kind: BanKind;
  expiresAt: Date | null;
  reason: string | null;
  byUserId: string | null;
  byMemberId: string | null;
  /** Tenant the ban belongs to. Phase 18 added the column; the type was incomplete until #364. */
  siteId: string;
  createdAt: Date;
}

export interface IssueBanInput {
  memberId: string;
  scopeType: BanScope;
  scopeId?: string | null;
  kind: BanKind;
  /** Required when `kind === "temporary"`. */
  expiresAt?: Date | null;
  reason?: string | null;
  actor: Principal;
}

export async function issueBan(input: IssueBanInput): Promise<NpBanRow> {
  if (input.kind === "temporary" && !(input.expiresAt instanceof Date)) {
    throw new NpValidationError("Invalid input", [
      { field: "expiresAt", message: "Temporary bans require an expiresAt timestamp" },
    ]);
  }
  if (input.scopeType !== "site" && !input.scopeId) {
    throw new NpValidationError("Invalid input", [
      { field: "scopeId", message: "Scoped bans require a scopeId" },
    ]);
  }

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const byUserId = input.actor.kind === "staff" ? input.actor.user.id : null;
  const byMemberId = input.actor.kind === "member" ? input.actor.memberId : null;

  // Phase 18 — site this ban applies to. For `scope_type='site'`
  // bans this column IS the site identifier; for category /
  // collection bans it scopes the slug to a particular tenant
  // (the same `posts` collection slug exists on every site).
  // #272 — write paths must NOT silently fall through to the
  // default site. A ban issued without site context would land
  // on tenant A's records when the staff member intended tenant B.
  const siteId = await requireSiteId();
  const [row] = (await db
    .insert(npBans)
    .values({
      memberId: input.memberId,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      kind: input.kind,
      expiresAt: input.expiresAt ?? null,
      reason: input.reason ?? null,
      byUserId,
      byMemberId,
      siteId,
    })
    .returning()) as NpBanRow[];
  if (!row) throw new Error("Ban insert returned no row");

  await recordAuditEvent({
    actor:
      input.actor.kind === "staff"
        ? { kind: "staff", userId: input.actor.user.id }
        : { kind: "member", memberId: input.actor.memberId },
    action: "member.ban",
    targetType: "member",
    targetId: input.memberId,
    payload: {
      banId: row.id,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      kind: row.kind,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      reason: row.reason,
    },
  });

  return row;
}

export async function listBansForMember(memberId: string): Promise<NpBanRow[]> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  // Active bans only — expired/revoked rows aren't shown by default.
  // Staff who want to see history can hit the audit log.
  // The `or()` helper wraps its branches in parens; a raw `sql` template
  // would let Postgres' AND-binds-tighter-than-OR rule re-associate
  // the predicate and leak active temp bans across members.
  // Phase 18 — scope to the current tenant so a ban issued on
  // tenant A doesn't surface in tenant B's mod surface.
  // #272 — read path: falling back to the default site is
  // intentional. A worker-side reconciler running without site
  // context should still see the default tenant's bans rather
  // than crash.
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const now = new Date();
  return (await db
    .select()
    .from(npBans)
    .where(
      and(
        eq(npBans.memberId, memberId),
        eq(npBans.siteId, siteId),
        or(isNull(npBans.expiresAt), gt(npBans.expiresAt, now)),
      ),
    )
    .orderBy(desc(npBans.createdAt))) as NpBanRow[];
}

export interface RevokeBanInput {
  banId: string;
  actor: Principal;
}

/**
 * "Revoking" a ban means deleting the row outright. The audit log
 * preserves the history (issue + revoke each leave an entry), so we
 * don't need a soft-delete column.
 */
export async function revokeBan(input: RevokeBanInput): Promise<void> {
  // Issue #364 — load + delete were id-only. Now require the
  // request site, reject when the loaded row is in a different
  // tenant, and pin `siteId` in the delete predicate so the
  // read-check and the write cannot drift.
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const requestSiteId = await requireSiteId();
  const [existing] = (await db
    .select()
    .from(npBans)
    .where(eq(npBans.id, input.banId))
    .limit(1)) as NpBanRow[];
  if (!existing) throw new NpNotFoundError("ban", input.banId);
  if (existing.siteId !== requestSiteId) {
    throw new NpForbiddenError("ban", "cross-site");
  }

  await db
    .delete(npBans)
    .where(and(eq(npBans.id, input.banId), eq(npBans.siteId, requestSiteId)));

  await recordAuditEvent({
    actor:
      input.actor.kind === "staff"
        ? { kind: "staff", userId: input.actor.user.id }
        : { kind: "member", memberId: input.actor.memberId },
    action: "member.unban",
    targetType: "member",
    targetId: existing.memberId,
    payload: { banId: existing.id, scopeType: existing.scopeType, scopeId: existing.scopeId },
  });
}

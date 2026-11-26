import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";

import { npRequireBanRow } from "../community-contract/contract.js";
import type { BanKind, BanScope, NpBanRow } from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npBans } from "../db/schema/community.js";
import { npMembers } from "../db/schema/community.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";

import { recordAuditEvent } from "./audit.js";
import type { Principal } from "./principal.js";

/**
 * Ban service. The 9.1a schema already had `np_bans`; this layer
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

export type { BanKind, BanScope, NpBanRow };

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

/** Explicit domain transaction seam. The caller owns mandatory audit/verification, if required.
 * All issuers lock the Member before changing its restrictions, including legacy staff APIs. */
export async function npIssueBanInTransactionV1(
  input: IssueBanInput & {
    db: ReturnType<typeof getDb>;
    siteId: string;
    now?: Date;
  },
): Promise<NpBanRow> {
  if (
    input.kind === "temporary" &&
    (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.valueOf()))
  ) {
    throw new NpValidationError("Invalid input", [
      { field: "expiresAt", message: "Temporary bans require an expiresAt timestamp" },
    ]);
  }
  if (input.kind === "permanent" && input.expiresAt != null) {
    throw new NpValidationError("Invalid input", [
      { field: "expiresAt", message: "Permanent bans must not expire" },
    ]);
  }
  if (input.scopeType !== "site" && !input.scopeId) {
    throw new NpValidationError("Invalid input", [
      { field: "scopeId", message: "Scoped bans require a scopeId" },
    ]);
  }
  if (input.scopeType === "site" && input.scopeId != null) {
    throw new NpValidationError("Invalid input", [
      { field: "scopeId", message: "Site bans must not include scopeId" },
    ]);
  }
  if (input.scopeId != null && input.scopeId.trim() !== input.scopeId) {
    throw new NpValidationError("Invalid input", [
      { field: "scopeId", message: "scopeId must not contain surrounding whitespace" },
    ]);
  }
  if (input.reason != null && input.reason.length > 1_000) {
    throw new NpValidationError("Invalid input", [
      { field: "reason", message: "Ban reason must be ≤ 1000 characters" },
    ]);
  }

  const db = input.db;
  const byUserId = input.actor.kind === "staff" ? input.actor.user.id : null;
  const byMemberId = input.actor.kind === "member" ? input.actor.memberId : null;

  // Phase 18 — site this ban applies to. For `scope_type='site'`
  // bans this column IS the site identifier; for category /
  // collection bans it scopes the slug to a particular tenant
  // (the same `posts` collection slug exists on every site).
  // #272 — write paths must NOT silently fall through to the
  // default site. A ban issued without site context would land
  // on tenant A's records when the staff member intended tenant B.
  const siteId = input.siteId;
  if (!npIsCanonicalSiteId(siteId)) throw new NpValidationError("Invalid ban site", []);
  const [member] = await db
    .select({ id: npMembers.id })
    .from(npMembers)
    .where(eq(npMembers.id, input.memberId))
    .for("no key update")
    .limit(1);
  if (!member) throw new NpNotFoundError("member", input.memberId);
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
      ...(input.now ? { createdAt: input.now } : {}),
    })
    .returning()) as NpBanRow[];
  if (!row) throw new Error("Ban insert returned no row");
  const checkedRow = npRequireBanRow(row);

  return checkedRow;
}

export async function issueBan(input: IssueBanInput): Promise<NpBanRow> {
  const siteId = await requireSiteId();
  const checkedRow = await getDb().transaction((db) =>
    npIssueBanInTransactionV1({ ...input, db, siteId }),
  );

  await recordAuditEvent({
    actor:
      input.actor.kind === "staff"
        ? { kind: "staff", userId: input.actor.user.id }
        : { kind: "member", memberId: input.actor.memberId },
    action: "member.ban",
    targetType: "member",
    targetId: input.memberId,
    payload: {
      banId: checkedRow.id,
      scopeType: checkedRow.scopeType,
      scopeId: checkedRow.scopeId,
      kind: checkedRow.kind,
      expiresAt: checkedRow.expiresAt?.toISOString() ?? null,
      reason: checkedRow.reason,
    },
  });

  return checkedRow;
}

export async function listBansForMember(memberId: string): Promise<NpBanRow[]> {
  const db = getDb();
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
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const now = new Date();
  const rows = (await db
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
  return rows.map(npRequireBanRow);
}

/**
 * Bounded same-site snapshot for composing staff review. The caller supplies its
 * existing DB/transaction and clock; no bootstrap, mutations or history inference.
 * One extra row reports whether the active result is incomplete.
 */
export async function npReadActiveMemberBansBounded(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  memberId: string;
  now: Date;
  limit: number;
}): Promise<{ rows: NpBanRow[]; hasMore: boolean }> {
  if (
    !npIsCanonicalSiteId(input.siteId) ||
    !(input.now instanceof Date) ||
    Number.isNaN(input.now.valueOf()) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100
  )
    throw new NpValidationError("Invalid bounded member restriction read", [
      {
        field: "memberRestrictions",
        message: "Canonical site, clock and a 1..100 limit are required",
      },
    ]);
  const rows = await input.db
    .select()
    .from(npBans)
    .where(
      and(
        eq(npBans.memberId, input.memberId),
        eq(npBans.siteId, input.siteId),
        or(isNull(npBans.expiresAt), gt(npBans.expiresAt, input.now)),
      ),
    )
    .orderBy(desc(npBans.createdAt), asc(npBans.id))
    .limit(input.limit + 1);
  return {
    rows: rows.slice(0, input.limit).map(npRequireBanRow),
    hasMore: rows.length > input.limit,
  };
}

export interface RevokeBanInput {
  banId: string;
  actor: Principal;
}

/** Exact current-site removal in the caller's transaction. A supplied expected row is a CAS fact. */
export async function npRevokeBanInTransactionV1(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  banId: string;
  expected?: NpBanRow;
}): Promise<NpBanRow> {
  const { db, siteId } = input;
  if (!npIsCanonicalSiteId(siteId)) throw new NpValidationError("Invalid ban site", []);
  const [seed] = await db.select().from(npBans).where(eq(npBans.id, input.banId)).limit(1);
  if (!seed) throw new NpNotFoundError("ban", input.banId);
  if (seed.siteId !== siteId) throw new NpForbiddenError("ban", "cross-site");
  await db
    .select({ id: npMembers.id })
    .from(npMembers)
    .where(eq(npMembers.id, seed.memberId))
    .for("no key update");
  const [row] = await db
    .select()
    .from(npBans)
    .where(and(eq(npBans.id, input.banId), eq(npBans.siteId, siteId)))
    .for("update")
    .limit(1);
  if (!row) throw new NpNotFoundError("ban", input.banId);
  const checked = npRequireBanRow(row);
  if (input.expected && JSON.stringify(checked) !== JSON.stringify(npRequireBanRow(input.expected)))
    throw new NpValidationError("The exact restriction changed", []);
  const deleted = await db
    .delete(npBans)
    .where(
      and(
        eq(npBans.id, input.banId),
        eq(npBans.siteId, siteId),
        eq(npBans.memberId, checked.memberId),
      ),
    )
    .returning({ id: npBans.id });
  if (deleted.length !== 1) throw new NpNotFoundError("ban", input.banId);
  return checked;
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
  const requestSiteId = await requireSiteId();
  const checkedExisting = await getDb().transaction((db) =>
    npRevokeBanInTransactionV1({ db, siteId: requestSiteId, banId: input.banId }),
  );

  await recordAuditEvent({
    actor:
      input.actor.kind === "staff"
        ? { kind: "staff", userId: input.actor.user.id }
        : { kind: "member", memberId: input.actor.memberId },
    action: "member.unban",
    targetType: "member",
    targetId: checkedExisting.memberId,
    payload: {
      banId: checkedExisting.id,
      scopeType: checkedExisting.scopeType,
      scopeId: checkedExisting.scopeId,
    },
  });
}

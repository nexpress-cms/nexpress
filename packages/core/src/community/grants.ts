import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import { npRequireMemberRoleGrantRow } from "../community-contract/contract.js";
import type { NpMemberRoleGrantRow } from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npMemberRoles } from "../db/schema/community.js";
import { NpConflictError, NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

import { recordAuditEvent } from "./audit.js";
import { getCommunityRole } from "./roles.js";
import type { CommunityScope } from "./roles.js";

/**
 * Member role grant service. Wraps `np_member_roles` writes with
 * registry validation, audit logging, and friendly errors for the
 * `(member, role, scope_type, scope_id)` unique conflict that
 * Postgres surfaces as a 23505 raw error.
 *
 * Read path (`memberCan` in `community/can.ts`) already filters by
 * `expires_at IS NULL OR expires_at > now`, so an expired grant
 * disappears from the resolver automatically — `listMemberRoleGrants`
 * mirrors that filter so the admin UI doesn't show ghost rows.
 *
 * Permission gating is the API layer's job (today: admin-only). The
 * core helpers don't re-check, so a privileged programmatic caller
 * can grant on behalf of any actor.
 */

export type { NpMemberRoleGrantRow };

export interface GrantMemberRoleInput {
  memberId: string;
  role: string;
  scopeType: CommunityScope;
  /** Required when `scopeType !== "site"`; ignored otherwise. */
  scopeId?: string | null;
  /** Optional time-boxed grant. `null` = perpetual. */
  expiresAt?: Date | null;
  /** Staff user issuing the grant — recorded on the row + audit. */
  grantedByUserId: string;
}

export async function grantMemberRole(input: GrantMemberRoleInput): Promise<NpMemberRoleGrantRow> {
  // Validate the role + scope pair is in the registry. Without this
  // a typo silently writes a row that `memberCan` will never match
  // — the grant looks active in the admin UI but does nothing.
  const definition = getCommunityRole(input.role, input.scopeType);
  if (!definition) {
    throw new NpValidationError("Invalid input", [
      {
        field: "role",
        message: `Unknown role '${input.role}' for scope '${input.scopeType}'`,
      },
    ]);
  }

  const scopeId = input.scopeType === "site" ? null : (input.scopeId ?? "").trim();
  if (input.scopeType !== "site" && !scopeId) {
    throw new NpValidationError("Invalid input", [
      { field: "scopeId", message: "scopeId required for non-site grants" },
    ]);
  }
  if (input.expiresAt instanceof Date && input.expiresAt.getTime() <= Date.now()) {
    throw new NpValidationError("Invalid input", [
      { field: "expiresAt", message: "expiresAt must be in the future" },
    ]);
  }

  const db = getDb();

  // Pre-check for an existing active grant matching the same
  // `(member, role, scope_type, scope_id)` tuple. The schema's
  // `np_member_roles_grant_uq` unique constraint catches duplicates
  // for non-null scope_ids natively, but site-wide grants have
  // `scope_id = NULL` and the constraint's `NULLS NOT DISTINCT`
  // clause depends on whether the DB was migrated post-PG-15-syntax.
  // The pre-check makes the conflict deterministic regardless of
  // constraint state and gives the API a clean 409 path.
  const normalizedScopeId = scopeId === "" ? null : scopeId;
  // Phase 18 — site this grant applies to. For
  // `scope_type='site'` this column IS the site identifier;
  // for category / collection / thread grants it scopes the
  // slug to a tenant.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const existing = (await db
    .select({ id: npMemberRoles.id })
    .from(npMemberRoles)
    .where(
      and(
        eq(npMemberRoles.memberId, input.memberId),
        eq(npMemberRoles.role, input.role),
        eq(npMemberRoles.scopeType, input.scopeType),
        eq(npMemberRoles.siteId, siteId),
        normalizedScopeId === null
          ? isNull(npMemberRoles.scopeId)
          : eq(npMemberRoles.scopeId, normalizedScopeId),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  if (existing.length > 0) {
    throw new NpConflictError(`Member already has this role grant in scope '${input.scopeType}'.`);
  }

  // Race fallback: even with the pre-check, two concurrent grants
  // could slip through. The DB constraint catches that for
  // non-null scopes; the catch block re-maps the error.
  let row: NpMemberRoleGrantRow;
  try {
    const [inserted] = (await db
      .insert(npMemberRoles)
      .values({
        memberId: input.memberId,
        role: input.role,
        scopeType: input.scopeType,
        scopeId: normalizedScopeId,
        siteId,
        grantedBy: input.grantedByUserId,
        expiresAt: input.expiresAt ?? null,
      })
      .returning()) as NpMemberRoleGrantRow[];
    if (!inserted) throw new Error("Grant insert returned no row");
    row = npRequireMemberRoleGrantRow(inserted);
  } catch (err) {
    // pg-node surfaces the unique-violation as a `DatabaseError`
    // with `code: "23505"`. Drizzle re-throws it untouched, so we
    // either match the SQLSTATE on the unwrapped object or
    // fall back to the message text (some adapters wrap the
    // error and only the message survives).
    const code = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : "";
    if (code === "23505" || /unique|23505|duplicate key/i.test(message)) {
      throw new NpConflictError(
        `Member already has this role grant in scope '${input.scopeType}'.`,
      );
    }
    throw err;
  }

  await recordAuditEvent({
    actor: { kind: "staff", userId: input.grantedByUserId },
    action: "member.role.grant",
    targetType: "member",
    targetId: input.memberId,
    payload: {
      grantId: row.id,
      role: row.role,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    },
  });

  return row;
}

/**
 * List currently-active grants for a member. Mirrors the
 * `memberCan` filter so expired rows are hidden.
 */
export async function listMemberRoleGrants(memberId: string): Promise<NpMemberRoleGrantRow[]> {
  const db = getDb();
  // Phase 18 — show only grants on the current tenant. A
  // member who's a community-mod on tenant A and not on
  // tenant B should see exactly one grant when admin pages
  // load on each.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const now = new Date();
  const rows = (await db
    .select()
    .from(npMemberRoles)
    .where(
      and(
        eq(npMemberRoles.memberId, memberId),
        eq(npMemberRoles.siteId, siteId),
        or(isNull(npMemberRoles.expiresAt), gt(npMemberRoles.expiresAt, now)),
      ),
    )
    .orderBy(desc(npMemberRoles.grantedAt))) as NpMemberRoleGrantRow[];
  return rows.map(npRequireMemberRoleGrantRow);
}

export interface RevokeMemberRoleInput {
  grantId: string;
  revokedByUserId: string;
}

/**
 * Revoke = hard delete. Audit trail preserves history. Mirrors
 * `revokeBan`'s semantic — the grant either exists and counts, or
 * it doesn't; soft-deleted rows would only confuse the resolver.
 */
export async function revokeMemberRole(input: RevokeMemberRoleInput): Promise<void> {
  // Issue #364 — delete was id-only. Now pin `siteId` in the
  // delete predicate so a staff user with a foreign grant id can't
  // revoke a grant in another tenant. NOT_FOUND on miss covers both
  // "no such grant" and "grant exists but in another site" — the
  // distinction is intentional: leaking which case applies would
  // confirm the foreign grant's existence.
  const db = getDb();
  const requestSiteId = await requireSiteId();
  const deleted = (await db
    .delete(npMemberRoles)
    .where(and(eq(npMemberRoles.id, input.grantId), eq(npMemberRoles.siteId, requestSiteId)))
    .returning()) as NpMemberRoleGrantRow[];
  if (deleted.length === 0) {
    // Use NOT_FOUND so the API maps to 404 — distinguishes "you
    // raced another revoke" from "the grant was never there in
    // the first place" only via response timing, but at least
    // the operator sees the right status code.
    throw new NpNotFoundError("memberRoleGrant", input.grantId);
  }
  const [existing] = deleted;
  const checkedExisting = npRequireMemberRoleGrantRow(existing);
  await recordAuditEvent({
    actor: { kind: "staff", userId: input.revokedByUserId },
    action: "member.role.revoke",
    targetType: "member",
    targetId: checkedExisting.memberId,
    payload: {
      grantId: checkedExisting.id,
      role: checkedExisting.role,
      scopeType: checkedExisting.scopeType,
      scopeId: checkedExisting.scopeId,
    },
  });
}

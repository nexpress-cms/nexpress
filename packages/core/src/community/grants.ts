import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { nxMemberRoles } from "../db/schema/community.js";
import { NxConflictError, NxNotFoundError, NxValidationError } from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";

import { recordAuditEvent } from "./audit.js";
import { getCommunityRole } from "./roles.js";
import type { CommunityScope } from "./roles.js";

/**
 * Member role grant service. Wraps `nx_member_roles` writes with
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

export interface NxMemberRoleGrantRow {
  id: string;
  memberId: string;
  role: string;
  scopeType: CommunityScope;
  scopeId: string | null;
  grantedBy: string | null;
  grantedAt: Date;
  expiresAt: Date | null;
  /** Tenant the grant belongs to. Phase 18 added the column; the type was incomplete until #364. */
  siteId: string;
}

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

export async function grantMemberRole(input: GrantMemberRoleInput): Promise<NxMemberRoleGrantRow> {
  // Validate the role + scope pair is in the registry. Without this
  // a typo silently writes a row that `memberCan` will never match
  // — the grant looks active in the admin UI but does nothing.
  const definition = getCommunityRole(input.role, input.scopeType);
  if (!definition) {
    throw new NxValidationError("Invalid input", [
      {
        field: "role",
        message: `Unknown role '${input.role}' for scope '${input.scopeType}'`,
      },
    ]);
  }

  const scopeId = input.scopeType === "site" ? null : (input.scopeId ?? "").trim();
  if (input.scopeType !== "site" && !scopeId) {
    throw new NxValidationError("Invalid input", [
      { field: "scopeId", message: "scopeId required for non-site grants" },
    ]);
  }
  if (input.expiresAt instanceof Date && input.expiresAt.getTime() <= Date.now()) {
    throw new NxValidationError("Invalid input", [
      { field: "expiresAt", message: "expiresAt must be in the future" },
    ]);
  }

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

  // Pre-check for an existing active grant matching the same
  // `(member, role, scope_type, scope_id)` tuple. The schema's
  // `nx_member_roles_grant_uq` unique constraint catches duplicates
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
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const existing = (await db
    .select({ id: nxMemberRoles.id })
    .from(nxMemberRoles)
    .where(
      and(
        eq(nxMemberRoles.memberId, input.memberId),
        eq(nxMemberRoles.role, input.role),
        eq(nxMemberRoles.scopeType, input.scopeType),
        eq(nxMemberRoles.siteId, siteId),
        normalizedScopeId === null
          ? isNull(nxMemberRoles.scopeId)
          : eq(nxMemberRoles.scopeId, normalizedScopeId),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  if (existing.length > 0) {
    throw new NxConflictError(`Member already has this role grant in scope '${input.scopeType}'.`);
  }

  // Race fallback: even with the pre-check, two concurrent grants
  // could slip through. The DB constraint catches that for
  // non-null scopes; the catch block re-maps the error.
  let row: NxMemberRoleGrantRow;
  try {
    const [inserted] = (await db
      .insert(nxMemberRoles)
      .values({
        memberId: input.memberId,
        role: input.role,
        scopeType: input.scopeType,
        scopeId: normalizedScopeId,
        siteId,
        grantedBy: input.grantedByUserId,
        expiresAt: input.expiresAt ?? null,
      })
      .returning()) as NxMemberRoleGrantRow[];
    if (!inserted) throw new Error("Grant insert returned no row");
    row = inserted;
  } catch (err) {
    // pg-node surfaces the unique-violation as a `DatabaseError`
    // with `code: "23505"`. Drizzle re-throws it untouched, so we
    // either match the SQLSTATE on the unwrapped object or
    // fall back to the message text (some adapters wrap the
    // error and only the message survives).
    const code = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : "";
    if (code === "23505" || /unique|23505|duplicate key/i.test(message)) {
      throw new NxConflictError(
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
export async function listMemberRoleGrants(memberId: string): Promise<NxMemberRoleGrantRow[]> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  // Phase 18 — show only grants on the current tenant. A
  // member who's a community-mod on tenant A and not on
  // tenant B should see exactly one grant when admin pages
  // load on each.
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const now = new Date();
  return (await db
    .select()
    .from(nxMemberRoles)
    .where(
      and(
        eq(nxMemberRoles.memberId, memberId),
        eq(nxMemberRoles.siteId, siteId),
        or(isNull(nxMemberRoles.expiresAt), gt(nxMemberRoles.expiresAt, now)),
      ),
    )
    .orderBy(desc(nxMemberRoles.grantedAt))) as NxMemberRoleGrantRow[];
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
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const requestSiteId = await requireSiteId();
  const deleted = (await db
    .delete(nxMemberRoles)
    .where(and(eq(nxMemberRoles.id, input.grantId), eq(nxMemberRoles.siteId, requestSiteId)))
    .returning()) as NxMemberRoleGrantRow[];
  if (deleted.length === 0) {
    // Use NOT_FOUND so the API maps to 404 — distinguishes "you
    // raced another revoke" from "the grant was never there in
    // the first place" only via response timing, but at least
    // the operator sees the right status code.
    throw new NxNotFoundError("memberRoleGrant", input.grantId);
  }
  const [existing] = deleted;
  await recordAuditEvent({
    actor: { kind: "staff", userId: input.revokedByUserId },
    action: "member.role.revoke",
    targetType: "member",
    targetId: existing.memberId,
    payload: {
      grantId: existing.id,
      role: existing.role,
      scopeType: existing.scopeType,
      scopeId: existing.scopeId,
    },
  });
}

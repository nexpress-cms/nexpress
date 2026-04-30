import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { nxSiteMemberships, nxUsers } from "../db/schema/system.js";
import { NxValidationError } from "../errors.js";
import type { NxAuthUser, NxUserRole } from "../config/types.js";

import { getCurrentSiteId } from "./context.js";
import { NX_DEFAULT_SITE_ID } from "./registry.js";

/**
 * Phase 15.5 — per-site role memberships.
 *
 * `nxUsers.role` stays the "global default role" (used by
 * existing single-tenant code and as a fallback when no
 * explicit membership exists for a given site). New
 * multi-tenant deployments grant explicit memberships via
 * the helpers here; the `isSuperAdmin` flag (also new in
 * 15.5) bypasses membership checks entirely so a super-admin
 * can administer every site without having to be enrolled
 * on each one individually.
 *
 * The framework's existing `hasRole(user, minRole)` keeps
 * working as a global check. New site-scoped checks should
 * use `hasRoleOnSite(user, siteId, minRole)`.
 */

export interface SiteMembership {
  siteId: string;
  userId: string;
  role: NxUserRole;
  createdAt: Date;
  updatedAt: Date;
}

export async function listSiteMemberships(
  siteId: string,
): Promise<SiteMembership[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(nxSiteMemberships)
    .where(eq(nxSiteMemberships.siteId, siteId));
  return rows.map((row) => ({
    siteId: row.siteId,
    userId: row.userId,
    role: row.role as NxUserRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listMembershipsForUser(
  userId: string,
): Promise<SiteMembership[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(nxSiteMemberships)
    .where(eq(nxSiteMemberships.userId, userId));
  return rows.map((row) => ({
    siteId: row.siteId,
    userId: row.userId,
    role: row.role as NxUserRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getMembership(
  siteId: string,
  userId: string,
): Promise<SiteMembership | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(nxSiteMemberships)
    .where(
      and(
        eq(nxSiteMemberships.siteId, siteId),
        eq(nxSiteMemberships.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    siteId: row.siteId,
    userId: row.userId,
    role: row.role as NxUserRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function grantSiteMembership(
  siteId: string,
  userId: string,
  role: NxUserRole,
): Promise<SiteMembership> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .insert(nxSiteMemberships)
    .values({ siteId, userId, role, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [nxSiteMemberships.siteId, nxSiteMemberships.userId],
      set: { role, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error("Failed to grant membership");
  return {
    siteId: row.siteId,
    userId: row.userId,
    role: row.role as NxUserRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function revokeSiteMembership(
  siteId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(nxSiteMemberships)
    .where(
      and(
        eq(nxSiteMemberships.siteId, siteId),
        eq(nxSiteMemberships.userId, userId),
      ),
    );
}

/**
 * Promote / demote a user's super-admin status. Super-admins
 * bypass per-site membership checks; this is the framework's
 * "I can do anything" gate so it should be granted sparingly
 * (one or two operators per deployment, typically).
 */
export async function setSuperAdmin(
  userId: string,
  isSuperAdmin: boolean,
): Promise<void> {
  const db = getDb();
  const result = await db
    .update(nxUsers)
    .set({ isSuperAdmin, updatedAt: new Date() })
    .where(eq(nxUsers.id, userId))
    .returning({ id: nxUsers.id });
  if (result.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "userId", message: `User "${userId}" not found` },
    ]);
  }
}

const ROLE_RANK: Record<NxUserRole, number> = {
  viewer: 0,
  author: 1,
  moderator: 2,
  editor: 3,
  admin: 4,
};

/**
 * Resolve a user's effective role on a specific site:
 *   1. Super-admins always get `admin`.
 *   2. Explicit site membership wins over the global role.
 *   3. Fallback: the user's global `nxUsers.role` (preserves
 *      single-tenant behavior).
 *
 * Use this rather than `user.role` for any check that should
 * respect tenant boundaries.
 */
export async function resolveUserRoleOnSite(
  user: NxAuthUser,
  siteId: string,
): Promise<NxUserRole> {
  // Super-admin shortcut — read from nxUsers (the JWT may
  // not carry the flag).
  const db = getDb();
  const [row] = await db
    .select({ isSuperAdmin: nxUsers.isSuperAdmin, role: nxUsers.role })
    .from(nxUsers)
    .where(eq(nxUsers.id, user.id))
    .limit(1);
  if (!row) return user.role;
  if (row.isSuperAdmin) return "admin";

  // Explicit membership for this site?
  const membership = await getMembership(siteId, user.id);
  if (membership) return membership.role;

  // Fallback to global default role.
  return row.role as NxUserRole;
}

/**
 * Site-scoped variant of `hasRole`. Resolves the user's
 * effective role on the site (super-admin → admin, explicit
 * membership → that role, otherwise global default) and
 * compares against `minRole` using the same rank order
 * `hasRole` uses.
 *
 * Defaults to the current request site (or the framework's
 * `default` site when no resolver is wired) so callers don't
 * have to thread siteId everywhere.
 */
export async function hasRoleOnSite(
  user: NxAuthUser,
  minRole: NxUserRole,
  siteId?: string,
): Promise<boolean> {
  const targetSite =
    siteId ?? (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const role = await resolveUserRoleOnSite(user, targetSite);
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/**
 * Quick boolean check for super-admin status. Cheaper than
 * `resolveUserRoleOnSite` when the caller only needs to know
 * "can this user manage the framework as a whole?".
 */
export async function isSuperAdmin(user: NxAuthUser): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ isSuperAdmin: nxUsers.isSuperAdmin })
    .from(nxUsers)
    .where(eq(nxUsers.id, user.id))
    .limit(1);
  return Boolean(row?.isSuperAdmin);
}

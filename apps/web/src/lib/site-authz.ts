import {
  NX_DEFAULT_SITE_ID,
  ROLE_HIERARCHY,
  can,
  getMembership,
  isSuperAdmin,
  type NpAuthUser,
} from "@nexpress/core";

/**
 * Authorize a staff user against a target-site mutation surface.
 * Used by every `/api/admin/sites/<id>/...` route that's NOT just a
 * read of public site metadata — site update / delete / usage /
 * memberships, etc.
 *
 * The ladder, in order:
 *
 *   1. Super-admin bypass (any site).
 *   2. Default-site fallback for global `admin.manage` so a
 *      single-tenant install (no explicit memberships configured)
 *      still works without per-site memberships needing to be
 *      seeded.
 *   3. Explicit membership at `admin` rank or above on the target
 *      site.
 *
 * Issue #216 closed the bug where `hasRoleOnSite` was falling
 * through to the user's global role and granting any global admin
 * access to every site — `getMembership` is the explicit-row check
 * that gate stands behind.
 */
export async function canManageSite(user: NpAuthUser, siteId: string): Promise<boolean> {
  if (await isSuperAdmin(user)) return true;
  if (siteId === NX_DEFAULT_SITE_ID && can(user, "admin.manage")) return true;
  const membership = await getMembership(siteId, user.id);
  if (!membership) return false;
  return ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY.admin;
}

/**
 * Moderator-rank counterpart to `canManageSite`. Same ladder, but
 * the membership rank check is `moderator` rather than `admin`,
 * and the default-site fallback uses `community.moderate`.
 *
 * Issue #379 — `hasRoleOnSite` falls through to the user's global
 * role when no explicit membership exists on the target site, so
 * a global moderator/editor/admin without site membership could
 * read a foreign tenant's audit log via `?siteId=<foreign>`. Use
 * this helper for any cross-tenant moderator-rank gate.
 */
export async function canModerateSite(user: NpAuthUser, siteId: string): Promise<boolean> {
  if (await isSuperAdmin(user)) return true;
  if (siteId === NX_DEFAULT_SITE_ID && can(user, "community.moderate")) return true;
  const membership = await getMembership(siteId, user.id);
  if (!membership) return false;
  return ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY.moderator;
}

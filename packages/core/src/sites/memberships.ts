import { and, eq } from "drizzle-orm";

import { can, type NpCapability } from "../auth/capabilities.js";
import type { NpAuthUser, NpUserRole } from "../config/types.js";
import { getDb } from "../db/runtime.js";
import { npSiteMemberships, npSites, npUsers } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import {
  npAssertSiteMembershipRecord,
  npIsCanonicalSiteId,
  npIsCanonicalUserId,
  npIsUserRole,
} from "../settings/contract.js";
import type { NpSiteMembershipRecord } from "../settings/types.js";

import { getCurrentSiteId } from "./context.js";
import { NP_DEFAULT_SITE_ID } from "./id-contract.js";

function invalid(field: string, message: string): NpValidationError {
  return new NpValidationError("Invalid input", [{ field, message }]);
}

function assertSiteId(siteId: unknown): asserts siteId is string {
  if (!npIsCanonicalSiteId(siteId)) {
    throw invalid("siteId", "siteId must be a canonical lowercase site id");
  }
}

function assertUserId(userId: unknown): asserts userId is string {
  if (!npIsCanonicalUserId(userId)) {
    throw invalid("userId", "userId must be a canonical UUID");
  }
}

function assertRole(role: unknown): asserts role is NpUserRole {
  if (!npIsUserRole(role)) {
    throw invalid("role", "role must be a registered NexPress user role");
  }
}

function rowToMembership(row: typeof npSiteMemberships.$inferSelect): NpSiteMembershipRecord {
  const membership = {
    siteId: row.siteId,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  npAssertSiteMembershipRecord(membership);
  return membership;
}

export async function listSiteMemberships(siteId: string): Promise<NpSiteMembershipRecord[]> {
  assertSiteId(siteId);
  const db = getDb();
  const [site] = await db.select({ id: npSites.id }).from(npSites).where(eq(npSites.id, siteId));
  if (!site) throw invalid("siteId", `Site "${siteId}" not found`);
  const rows = await db
    .select()
    .from(npSiteMemberships)
    .where(eq(npSiteMemberships.siteId, siteId));
  return rows.map(rowToMembership);
}

export async function listMembershipsForUser(userId: string): Promise<NpSiteMembershipRecord[]> {
  assertUserId(userId);
  const db = getDb();
  const [user] = await db.select({ id: npUsers.id }).from(npUsers).where(eq(npUsers.id, userId));
  if (!user) throw invalid("userId", `User "${userId}" not found`);
  const rows = await db
    .select()
    .from(npSiteMemberships)
    .where(eq(npSiteMemberships.userId, userId));
  return rows.map(rowToMembership);
}

export async function getMembership(
  siteId: string,
  userId: string,
): Promise<NpSiteMembershipRecord | null> {
  assertSiteId(siteId);
  assertUserId(userId);
  const db = getDb();
  const [row] = await db
    .select()
    .from(npSiteMemberships)
    .where(and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, userId)))
    .limit(1);
  return row ? rowToMembership(row) : null;
}

export async function grantSiteMembership(
  siteId: string,
  userId: string,
  role: NpUserRole,
): Promise<NpSiteMembershipRecord> {
  assertSiteId(siteId);
  assertUserId(userId);
  assertRole(role);
  const db = getDb();
  return db.transaction(async (transaction) => {
    const tx = transaction as ReturnType<typeof getDb>;
    const [[site], [user]] = await Promise.all([
      tx.select({ id: npSites.id }).from(npSites).where(eq(npSites.id, siteId)).limit(1),
      tx.select({ id: npUsers.id }).from(npUsers).where(eq(npUsers.id, userId)).limit(1),
    ]);
    if (!site) throw invalid("siteId", `Site "${siteId}" not found`);
    if (!user) throw invalid("userId", `User "${userId}" not found`);

    const now = new Date();
    const [row] = await tx
      .insert(npSiteMemberships)
      .values({ siteId, userId, role, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [npSiteMemberships.siteId, npSiteMemberships.userId],
        set: { role, updatedAt: now },
      })
      .returning();
    if (!row) throw new Error("Failed to grant site membership");
    return rowToMembership(row);
  });
}

export async function revokeSiteMembership(siteId: string, userId: string): Promise<void> {
  assertSiteId(siteId);
  assertUserId(userId);
  const db = getDb();
  await db
    .delete(npSiteMemberships)
    .where(and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, userId)));
}

export async function setSuperAdmin(userId: string, isSuperAdmin: boolean): Promise<void> {
  assertUserId(userId);
  if (typeof isSuperAdmin !== "boolean") {
    throw invalid("isSuperAdmin", "isSuperAdmin must be boolean");
  }
  const db = getDb();
  const result = await db
    .update(npUsers)
    .set({ isSuperAdmin, updatedAt: new Date() })
    .where(eq(npUsers.id, userId))
    .returning({ id: npUsers.id });
  if (result.length === 0) throw invalid("userId", `User "${userId}" not found`);
}

/**
 * Project an authenticated user onto one registered site's persisted role.
 * Super-admins project to admin on every site. An explicit membership supplies
 * the role for that site. Only the reserved default site may fall back to the
 * user's global role; every other site requires membership.
 */
async function resolveSiteAuthorization(
  user: NpAuthUser,
  siteId?: string,
): Promise<{ user: NpAuthUser; isSuperAdmin: boolean } | null> {
  const targetSiteId = siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  assertSiteId(targetSiteId);
  assertUserId(user.id);

  const db = getDb();
  const [[persistedUser], [site], [membership]] = await Promise.all([
    db
      .select({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
        isSuperAdmin: npUsers.isSuperAdmin,
      })
      .from(npUsers)
      .where(eq(npUsers.id, user.id))
      .limit(1),
    db.select({ id: npSites.id }).from(npSites).where(eq(npSites.id, targetSiteId)).limit(1),
    db
      .select({ role: npSiteMemberships.role })
      .from(npSiteMemberships)
      .where(and(eq(npSiteMemberships.siteId, targetSiteId), eq(npSiteMemberships.userId, user.id)))
      .limit(1),
  ]);
  if (!persistedUser || !site) return null;

  const effectiveRole =
    (persistedUser.isSuperAdmin ? "admin" : membership?.role) ??
    (targetSiteId === NP_DEFAULT_SITE_ID ? persistedUser.role : null);
  if (!effectiveRole) return null;
  return {
    user: {
      id: persistedUser.id,
      email: persistedUser.email,
      name: persistedUser.name,
      role: effectiveRole,
      tokenVersion: persistedUser.tokenVersion,
    },
    isSuperAdmin: persistedUser.isSuperAdmin,
  };
}

export async function resolveSiteAuthUser(
  user: NpAuthUser,
  siteId?: string,
): Promise<NpAuthUser | null> {
  return (await resolveSiteAuthorization(user, siteId))?.user ?? null;
}

/** Resolve one capability against the persisted site authorization state. */
export async function canOnSite(
  user: NpAuthUser,
  capability: NpCapability,
  siteId?: string,
): Promise<boolean> {
  const authorization = await resolveSiteAuthorization(user, siteId);
  return authorization ? authorization.isSuperAdmin || can(authorization.user, capability) : false;
}

export async function isSuperAdmin(user: NpAuthUser): Promise<boolean> {
  if (!npIsCanonicalUserId(user.id)) return false;
  const db = getDb();
  const [row] = await db
    .select({ isSuperAdmin: npUsers.isSuperAdmin })
    .from(npUsers)
    .where(eq(npUsers.id, user.id))
    .limit(1);
  return Boolean(row?.isSuperAdmin);
}

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";

import { can, type NpCapability } from "../auth/capabilities.js";
import type { NpAuthUser, NpUserRole } from "../config/types.js";
import { getDb } from "../db/runtime.js";
import { npAgentPrincipals } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
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
import {
  npGetSiteAuthorityObserverV1,
  type NpSiteAuthorityMutationActorV1,
  type NpSiteAuthorityMutationScopeV1,
} from "./authority-observer.js";

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

function mutationActor(
  context: { actor: NpSiteAuthorityMutationActorV1 } | undefined,
): NpSiteAuthorityMutationActorV1 {
  const actor = context?.actor;
  if (actor === undefined) return { kind: "system", component: "sites.memberships" };
  if (actor?.kind === "staff" && npIsCanonicalUserId(actor.userId))
    return { kind: "staff", userId: actor.userId };
  if (
    actor?.kind === "system" &&
    typeof actor.component === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(actor.component)
  )
    return { kind: "system", component: actor.component };
  throw invalid("actor", "actor must identify a staff user or system component");
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

type MembershipDb = ReturnType<typeof getDb>;

/** Match Runtime admission's principal-before-user lock order. */
async function lockRuntimeDelegations(db: MembershipDb, userId: string, siteId?: string) {
  return db
    .select()
    .from(npAgentPrincipals)
    .where(
      and(
        eq(npAgentPrincipals.kind, "runtime"),
        eq(npAgentPrincipals.authorityKind, "user"),
        eq(npAgentPrincipals.authorityUserId, userId),
        siteId === undefined ? undefined : eq(npAgentPrincipals.siteId, siteId),
      ),
    )
    .orderBy(asc(npAgentPrincipals.siteId), asc(npAgentPrincipals.id))
    .for("update");
}

async function invalidateRuntimeDelegations(
  db: MembershipDb,
  principals: Awaited<ReturnType<typeof lockRuntimeDelegations>>,
  reason: "membership_changed" | "membership_removed" | "super_admin_changed",
  now: Date,
) {
  for (const principal of principals) {
    await db
      .update(npAgentPrincipals)
      .set({
        rowVersion: principal.rowVersion + 1,
        tokenVersion: principal.tokenVersion + 1,
        updatedAt: now,
      })
      .where(eq(npAgentPrincipals.id, principal.id));
    await db.insert(npAuditEvents).values({
      actorKind: "system",
      action: "agents.runtime.principals.authority_changed",
      targetType: "agent-principal",
      targetId: principal.id,
      siteId: principal.siteId,
      payload: { outcome: "invalidated", reason },
      createdAt: now,
    });
  }
}

export async function grantSiteMembership(
  siteId: string,
  userId: string,
  role: NpUserRole,
  context?: { actor: NpSiteAuthorityMutationActorV1 },
): Promise<NpSiteMembershipRecord> {
  assertSiteId(siteId);
  assertUserId(userId);
  assertRole(role);
  const observer = npGetSiteAuthorityObserverV1();
  const actor = observer ? mutationActor(context) : null;
  const scope: NpSiteAuthorityMutationScopeV1 = { kind: "site", siteId };
  const db = getDb();
  return db.transaction(async (transaction) => {
    const tx = transaction as ReturnType<typeof getDb>;
    if (observer) await observer.prepare({ db: tx, scope });
    const principals = await lockRuntimeDelegations(tx, userId, siteId);
    const [site] = await tx
      .select({ id: npSites.id })
      .from(npSites)
      .where(eq(npSites.id, siteId))
      .limit(1);
    const [user] = await tx
      .select({ id: npUsers.id })
      .from(npUsers)
      .where(eq(npUsers.id, userId))
      .for("update")
      .limit(1);
    if (!site) throw invalid("siteId", `Site "${siteId}" not found`);
    if (!user) throw invalid("userId", `User "${userId}" not found`);
    const [previous] = await tx
      .select()
      .from(npSiteMemberships)
      .where(and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, userId)))
      .for("update")
      .limit(1);
    if (previous?.role === role) return rowToMembership(previous);
    const now = new Date();
    await invalidateRuntimeDelegations(tx, principals, "membership_changed", now);
    const [row] = await tx
      .insert(npSiteMemberships)
      .values({ siteId, userId, role, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [npSiteMemberships.siteId, npSiteMemberships.userId],
        set: { role, updatedAt: now },
      })
      .returning();
    if (!row) throw new Error("Failed to grant site membership");
    if (observer && actor)
      await observer.record({
        db: tx,
        scope,
        actor,
        transitionId: randomUUID(),
        occurredAt: now,
        transition: {
          kind: "site-role",
          userId,
          previousRole: previous?.role ?? null,
          currentRole: row.role,
        },
      });
    return rowToMembership(row);
  });
}

export async function revokeSiteMembership(
  siteId: string,
  userId: string,
  context?: { actor: NpSiteAuthorityMutationActorV1 },
): Promise<void> {
  assertSiteId(siteId);
  assertUserId(userId);
  const observer = npGetSiteAuthorityObserverV1();
  const actor = observer ? mutationActor(context) : null;
  const scope: NpSiteAuthorityMutationScopeV1 = { kind: "site", siteId };
  const db = getDb();
  await db.transaction(async (transaction) => {
    const tx = transaction as MembershipDb;
    if (observer) await observer.prepare({ db: tx, scope });
    const principals = await lockRuntimeDelegations(tx, userId, siteId);
    await tx.select({ id: npUsers.id }).from(npUsers).where(eq(npUsers.id, userId)).for("update");
    const [previous] = await tx
      .select()
      .from(npSiteMemberships)
      .where(and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, userId)))
      .for("update")
      .limit(1);
    if (!previous) return;
    const now = new Date();
    await invalidateRuntimeDelegations(tx, principals, "membership_removed", now);
    const deletion = tx
      .delete(npSiteMemberships)
      .where(and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, userId)));
    if (observer && actor) {
      const [deleted] = await deletion.returning({ role: npSiteMemberships.role });
      if (!deleted) throw new Error("Failed to revoke site membership");
      await observer.record({
        db: tx,
        scope,
        actor,
        transitionId: randomUUID(),
        occurredAt: now,
        transition: {
          kind: "site-role",
          userId,
          previousRole: deleted.role,
          currentRole: null,
        },
      });
    } else await deletion;
  });
}

export async function setSuperAdmin(
  userId: string,
  isSuperAdmin: boolean,
  context?: { actor: NpSiteAuthorityMutationActorV1 },
): Promise<void> {
  assertUserId(userId);
  if (typeof isSuperAdmin !== "boolean") {
    throw invalid("isSuperAdmin", "isSuperAdmin must be boolean");
  }
  const observer = npGetSiteAuthorityObserverV1();
  const actor = observer ? mutationActor(context) : null;
  const scope: NpSiteAuthorityMutationScopeV1 = { kind: "deployment" };
  const db = getDb();
  await db.transaction(async (transaction) => {
    const tx = transaction as MembershipDb;
    if (observer) await observer.prepare({ db: tx, scope });
    const principals = await lockRuntimeDelegations(tx, userId);
    const [user] = await tx
      .select()
      .from(npUsers)
      .where(eq(npUsers.id, userId))
      .for("update")
      .limit(1);
    if (!user) throw invalid("userId", `User "${userId}" not found`);
    if (user.isSuperAdmin === isSuperAdmin) return;
    const now = new Date();
    await invalidateRuntimeDelegations(tx, principals, "super_admin_changed", now);
    const update = tx
      .update(npUsers)
      .set({ isSuperAdmin, updatedAt: now })
      .where(eq(npUsers.id, userId));
    if (observer && actor) {
      const [updated] = await update.returning({ isSuperAdmin: npUsers.isSuperAdmin });
      if (!updated) throw new Error("Failed to set super administrator");
      await observer.record({
        db: tx,
        scope,
        actor,
        transitionId: randomUUID(),
        occurredAt: now,
        transition: {
          kind: "super-admin",
          userId,
          previous: user.isSuperAdmin,
          current: updated.isSuperAdmin,
        },
      });
    } else await update;
  });
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

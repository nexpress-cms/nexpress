import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { recordAuditEvent } from "../community/audit.js";
import {
  npMemberIdentities,
  npMembers,
} from "../db/schema/community.js";
import { npUserOAuthIdentities, npUsers } from "../db/schema/system.js";
import { NpNotFoundError } from "../errors.js";

/**
 * Admin-side helpers for listing and revoking OAuth identity links.
 * Both staff (`nx_user_oauth_identities`) and member
 * (`nx_member_identities`) tables use the same shape: one row per
 * (account, provider) pair, holding the durable provider subject
 * plus arbitrary metadata. These helpers are the source of truth for
 * `/api/admin/users/[id]/identities` and the member equivalent.
 *
 * Revoking does not invalidate sessions — the user / member can
 * re-link by signing in via OAuth again, which creates a fresh
 * identity row through the resolver. Revocation is intentionally
 * reversible because the durable link is the only thing dropped;
 * the underlying account remains.
 */

export interface NpUserIdentityRow {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NpMemberIdentityRow {
  id: string;
  memberId: string;
  provider: string;
  subject: string;
  email: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

async function assertUserExists(userId: string): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ id: npUsers.id })
    .from(npUsers)
    .where(eq(npUsers.id, userId))
    .limit(1)) as Array<{ id: string }>;
  if (!row) throw new NpNotFoundError("user", userId);
}

async function assertMemberExists(memberId: string): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ id: npMembers.id })
    .from(npMembers)
    .where(eq(npMembers.id, memberId))
    .limit(1)) as Array<{ id: string }>;
  if (!row) throw new NpNotFoundError("member", memberId);
}

export async function listUserIdentities(userId: string): Promise<NpUserIdentityRow[]> {
  await assertUserExists(userId);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const rows = (await db
    .select()
    .from(npUserOAuthIdentities)
    .where(eq(npUserOAuthIdentities.userId, userId))
    .orderBy(desc(npUserOAuthIdentities.createdAt))) as NpUserIdentityRow[];
  return rows;
}

export async function listMemberIdentities(memberId: string): Promise<NpMemberIdentityRow[]> {
  await assertMemberExists(memberId);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const rows = (await db
    .select()
    .from(npMemberIdentities)
    .where(eq(npMemberIdentities.memberId, memberId))
    .orderBy(desc(npMemberIdentities.createdAt))) as NpMemberIdentityRow[];
  return rows;
}

export interface RevokeIdentityInput {
  /** Staff user id whose identity is being revoked (`actorKind: "staff"`). */
  staffUserId: string;
}

export async function revokeUserIdentity(
  userId: string,
  identityId: string,
  actor: RevokeIdentityInput,
): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  // Fetch the row first so the audit event captures the provider /
  // subject — once deleted we'd lose the forensic context.
  const [existing] = (await db
    .select()
    .from(npUserOAuthIdentities)
    .where(
      and(
        eq(npUserOAuthIdentities.id, identityId),
        eq(npUserOAuthIdentities.userId, userId),
      ),
    )
    .limit(1)) as NpUserIdentityRow[];
  if (!existing) {
    // Either the identity doesn't exist or it belongs to a different
    // user — both surface as 404 to avoid leaking cross-user
    // existence to staff who don't have the right grants.
    throw new NpNotFoundError("identity", identityId);
  }
  // Use `.returning()` so we can tell whether OUR call did the
  // delete. Two concurrent revokes both pass the select check
  // above; if we record an audit event unconditionally we'd
  // double-log the revocation. The second caller's delete returns
  // zero rows — we skip the audit there.
  const deleted = (await db
    .delete(npUserOAuthIdentities)
    .where(eq(npUserOAuthIdentities.id, identityId))
    .returning({ id: npUserOAuthIdentities.id })) as Array<{ id: string }>;
  if (deleted.length === 0) return;
  await recordAuditEvent({
    actor: { kind: "staff", userId: actor.staffUserId },
    action: "user.identity.revoke",
    targetType: "user",
    targetId: userId,
    payload: {
      identityId,
      provider: existing.provider,
      providerUserId: existing.providerUserId,
    },
  });
}

export async function revokeMemberIdentity(
  memberId: string,
  identityId: string,
  actor: RevokeIdentityInput,
): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select()
    .from(npMemberIdentities)
    .where(
      and(
        eq(npMemberIdentities.id, identityId),
        eq(npMemberIdentities.memberId, memberId),
      ),
    )
    .limit(1)) as NpMemberIdentityRow[];
  if (!existing) throw new NpNotFoundError("identity", identityId);
  const deleted = (await db
    .delete(npMemberIdentities)
    .where(eq(npMemberIdentities.id, identityId))
    .returning({ id: npMemberIdentities.id })) as Array<{ id: string }>;
  if (deleted.length === 0) return;
  await recordAuditEvent({
    actor: { kind: "staff", userId: actor.staffUserId },
    action: "member.identity.revoke",
    targetType: "member",
    targetId: memberId,
    payload: {
      identityId,
      provider: existing.provider,
      subject: existing.subject,
    },
  });
}

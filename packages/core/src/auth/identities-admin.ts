import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { recordAuditEvent } from "../community/audit.js";
import {
  nxMemberIdentities,
  nxMembers,
} from "../db/schema/community.js";
import { nxUserOAuthIdentities, nxUsers } from "../db/schema/system.js";
import { NxNotFoundError } from "../errors.js";

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

export interface NxUserIdentityRow {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NxMemberIdentityRow {
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
    .select({ id: nxUsers.id })
    .from(nxUsers)
    .where(eq(nxUsers.id, userId))
    .limit(1)) as Array<{ id: string }>;
  if (!row) throw new NxNotFoundError("user", userId);
}

async function assertMemberExists(memberId: string): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.id, memberId))
    .limit(1)) as Array<{ id: string }>;
  if (!row) throw new NxNotFoundError("member", memberId);
}

export async function listUserIdentities(userId: string): Promise<NxUserIdentityRow[]> {
  await assertUserExists(userId);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const rows = (await db
    .select()
    .from(nxUserOAuthIdentities)
    .where(eq(nxUserOAuthIdentities.userId, userId))
    .orderBy(desc(nxUserOAuthIdentities.createdAt))) as NxUserIdentityRow[];
  return rows;
}

export async function listMemberIdentities(memberId: string): Promise<NxMemberIdentityRow[]> {
  await assertMemberExists(memberId);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const rows = (await db
    .select()
    .from(nxMemberIdentities)
    .where(eq(nxMemberIdentities.memberId, memberId))
    .orderBy(desc(nxMemberIdentities.createdAt))) as NxMemberIdentityRow[];
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
    .from(nxUserOAuthIdentities)
    .where(
      and(
        eq(nxUserOAuthIdentities.id, identityId),
        eq(nxUserOAuthIdentities.userId, userId),
      ),
    )
    .limit(1)) as NxUserIdentityRow[];
  if (!existing) {
    // Either the identity doesn't exist or it belongs to a different
    // user — both surface as 404 to avoid leaking cross-user
    // existence to staff who don't have the right grants.
    throw new NxNotFoundError("identity", identityId);
  }
  await db
    .delete(nxUserOAuthIdentities)
    .where(eq(nxUserOAuthIdentities.id, identityId));
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
    .from(nxMemberIdentities)
    .where(
      and(
        eq(nxMemberIdentities.id, identityId),
        eq(nxMemberIdentities.memberId, memberId),
      ),
    )
    .limit(1)) as NxMemberIdentityRow[];
  if (!existing) throw new NxNotFoundError("identity", identityId);
  await db.delete(nxMemberIdentities).where(eq(nxMemberIdentities.id, identityId));
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

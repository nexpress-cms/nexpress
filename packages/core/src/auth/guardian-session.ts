import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NpAuthContractError, npIsCanonicalAuthId } from "../auth-contract/index.js";
import { npAssertAgentPreviewEffectsAllowed } from "../agent/changeset-preview-overlay.js";
import { npMemberSessions } from "../db/schema/community.js";
import { npSessions } from "../db/schema/system.js";

type SessionDb = NodePgDatabase<Record<string, unknown>>;

/** Private, server-resolved browser family. This is never an HTTP/model target input. */
export interface NpGuardianSessionFamilyRefV1 {
  actorKind: "staff" | "member";
  principalId: string;
  sessionFamilyId: string;
}
export interface NpGuardianSessionFamilyV1 extends NpGuardianSessionFamilyRefV1 {
  createdAt: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

function invalid(path: string): never {
  throw new NpAuthContractError("Invalid Guardian browser session reference", [
    { code: "invalid-field", path, message: "must identify one exact existing browser family" },
  ]);
}
function requireRef(ref: NpGuardianSessionFamilyRefV1): NpGuardianSessionFamilyRefV1 {
  if (ref.actorKind !== "staff" && ref.actorKind !== "member") invalid("actorKind");
  if (!npIsCanonicalAuthId(ref.principalId)) invalid("principalId");
  if (!npIsCanonicalAuthId(ref.sessionFamilyId)) invalid("sessionFamilyId");
  return {
    actorKind: ref.actorKind,
    principalId: ref.principalId,
    sessionFamilyId: ref.sessionFamilyId,
  };
}

/**
 * Read only the family identity and its lifetimes. Neither staff nor member
 * session rows currently prove site ownership; callers must classify both as
 * deployment impact. Refresh rotation preserves id/owner/createdAt.
 *
 * A locking read participates in the caller's transaction and must be taken
 * using the caller's authority/session lock ordering; it creates no transaction.
 */
export async function npReadGuardianSessionFamilyV1(
  db: SessionDb,
  ref: NpGuardianSessionFamilyRefV1,
  options: { lock?: boolean } = {},
): Promise<NpGuardianSessionFamilyV1 | null> {
  if (options.lock) npAssertAgentPreviewEffectsAllowed();
  const identity = requireRef(ref);
  const table = identity.actorKind === "staff" ? npSessions : npMemberSessions;
  const owner = identity.actorKind === "staff" ? npSessions.userId : npMemberSessions.memberId;
  const query = db
    .select({
      createdAt: table.createdAt,
      accessExpiresAt: table.accessExpiresAt,
      refreshExpiresAt: table.refreshExpiresAt,
    })
    .from(table)
    .where(and(eq(table.id, identity.sessionFamilyId), eq(owner, identity.principalId)))
    .limit(1);
  const [row] = options.lock ? await query.for("update") : await query;
  return row
    ? {
        ...identity,
        createdAt: row.createdAt.toISOString(),
        accessExpiresAt: row.accessExpiresAt.toISOString(),
        refreshExpiresAt: row.refreshExpiresAt.toISOString(),
      }
    : null;
}

/**
 * Effect seam for an already-authorized exact family, on the caller's atomic
 * transaction. Deletes its access/refresh pair together; other browser families,
 * principal tokenVersion, provider credentials and Gateway tokens are untouched.
 * False is a conflict/absence, never evidence that this request revoked anything.
 */
export async function npRevokeGuardianSessionFamilyV1(
  db: SessionDb,
  ref: NpGuardianSessionFamilyRefV1,
  expectedCreatedAt: string,
): Promise<boolean> {
  npAssertAgentPreviewEffectsAllowed();
  const identity = requireRef(ref);
  const createdAt = new Date(expectedCreatedAt);
  if (!Number.isFinite(createdAt.valueOf()) || createdAt.toISOString() !== expectedCreatedAt)
    invalid("createdAt");
  const table = identity.actorKind === "staff" ? npSessions : npMemberSessions;
  const owner = identity.actorKind === "staff" ? npSessions.userId : npMemberSessions.memberId;
  const rows = await db
    .delete(table)
    .where(
      and(
        eq(table.id, identity.sessionFamilyId),
        eq(owner, identity.principalId),
        eq(table.createdAt, createdAt),
      ),
    )
    .returning({ id: table.id });
  return rows.length === 1;
}

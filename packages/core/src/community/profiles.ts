import { and, eq, inArray } from "drizzle-orm";

import { npIsCanonicalAuthId } from "../auth-contract/contract.js";
import { getDb } from "../db/runtime.js";
import { npMembers } from "../db/schema/community.js";
import { getMediaUrl } from "../media/url.js";
import { npRequirePublicMemberProfileWire } from "../community-contract/contract.js";
import type { NpPublicMemberProfileWire } from "../community-contract/types.js";

/**
 * Public-facing member profile. Hand-picked from `np_members` to
 * exclude PII (email, password hash, login attempts, reset tokens,
 * notification prefs, plugin meta) — page authors building public
 * surfaces (`/u/[handle]` etc.) get a safe-to-render shape without
 * having to remember which columns are sensitive.
 *
 * Pending, suspended, and deleted members are filtered out — calling
 * `getMemberProfile` for a hidden member returns `null`. The
 * "imported" status (Phase 21 WordPress-import provisional members)
 * IS exposed because those profiles are visible on the public site
 * by design. Bans are a separate, scope-based concept (`np_bans`)
 * and don't hide the profile shell — they restrict posting; the
 * profile page itself stays reachable like Reddit / Discourse.
 */
export interface NpMemberProfile {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  reputation: number;
  joinedAt: Date;
}

export function npToPublicMemberProfileWire(profile: NpMemberProfile): NpPublicMemberProfileWire {
  return npRequirePublicMemberProfileWire({
    id: profile.id,
    handle: profile.handle,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    reputation: profile.reputation,
    joinedAt: profile.joinedAt.toISOString(),
  });
}

/**
 * Fetch a public member profile by id or handle.
 *
 * Resolves the avatar to a public URL (via `getMediaUrl`) so the
 * caller doesn't need to know about the storage adapter. Pass an
 * explicit `variant` to fetch a sized avatar — defaults to
 * `"thumbnail"` since profile cards typically render at small
 * sizes. Pass `"original"` for the full avatar (e.g. on the
 * profile detail page itself).
 *
 * Returns `null` when:
 *  - no row matches the id / handle,
 *  - the member's status is not `active` or `imported` (treat as
 *    "not found" for public surfaces).
 */
export async function getMemberProfile(
  idOrHandle: string,
  options: {
    avatarVariant?: "original" | "thumbnail" | "small" | "medium" | "large" | (string & {});
  } = {},
): Promise<NpMemberProfile | null> {
  if (typeof idOrHandle !== "string" || idOrHandle.length === 0) return null;

  // Handles are stored lowercase by `api/members/register`; URL
  // segments can come in any case (`/u/HANDLE` should resolve the
  // same as `/u/handle`). Lowercasing the input is also a no-op
  // for UUIDs — they're stored lowercase too — so we don't need
  // to detect which form the caller passed.
  const needle = idOrHandle.toLowerCase();
  const db = getDb();

  // PostgreSQL UUID columns reject arbitrary handle strings before an OR
  // predicate can short-circuit. Canonical ids and handles are disjoint by
  // contract, so choose the typed predicate before sending the query.
  const identity = npIsCanonicalAuthId(needle)
    ? eq(npMembers.id, needle)
    : eq(npMembers.handle, needle);
  const rows = await db
    .select({
      id: npMembers.id,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
      avatarId: npMembers.avatar,
      bio: npMembers.bio,
      reputation: npMembers.reputation,
      status: npMembers.status,
      createdAt: npMembers.createdAt,
    })
    .from(npMembers)
    .where(and(identity, inArray(npMembers.status, ["active", "imported"])))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const avatarUrl = row.avatarId
    ? await getMemberAvatarUrl(row.avatarId, options.avatarVariant ?? "thumbnail")
    : null;

  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl,
    bio: row.bio ?? null,
    reputation: row.reputation,
    joinedAt: row.createdAt,
  };
}

async function getMemberAvatarUrl(mediaId: string, variant: string): Promise<string | null> {
  try {
    return await getMediaUrl(mediaId, { variant });
  } catch {
    // Storage adapter not initialized in this context — non-fatal
    // for profile rendering; just omit the avatar.
    return null;
  }
}

/**
 * Batch variant of `getMemberProfile` for listings (discussion
 * indexes, comment threads, follower lists, …). Single SELECT
 * for the rows; avatar URLs resolve in parallel via `Promise.all`.
 *
 * The caller passes member IDs (the `memberAuthorId` /
 * `memberId` foreign keys most listing rows already carry).
 * Handle-based batches aren't supported — list rows that
 * reference a handle and not an id are rare; pass IDs.
 *
 * Returns a `Map<id, NpMemberProfile>` with one entry per id
 * that matched (suspended / deleted members are dropped, so the
 * map size may be smaller than the input). Order isn't preserved
 * because callers typically use `byId.get(row.memberId)` per row
 * rather than a parallel array.
 *
 * Empty input → empty map (no DB query).
 */
export async function getMemberProfiles(
  ids: readonly string[],
  options: {
    avatarVariant?: "original" | "thumbnail" | "small" | "medium" | "large" | (string & {});
  } = {},
): Promise<Map<string, NpMemberProfile>> {
  const result = new Map<string, NpMemberProfile>();
  if (ids.length === 0) return result;
  // Dedupe — listing pages often have the same author repeated
  // across rows.
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
  if (unique.length === 0) return result;

  const db = getDb();
  const rows = await db
    .select({
      id: npMembers.id,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
      avatarId: npMembers.avatar,
      bio: npMembers.bio,
      reputation: npMembers.reputation,
      status: npMembers.status,
      createdAt: npMembers.createdAt,
    })
    .from(npMembers)
    .where(and(inArray(npMembers.id, unique), inArray(npMembers.status, ["active", "imported"])));

  const variant = options.avatarVariant ?? "thumbnail";
  await Promise.all(
    rows.map(async (row) => {
      const avatarUrl = row.avatarId ? await getMemberAvatarUrl(row.avatarId, variant) : null;
      result.set(row.id, {
        id: row.id,
        handle: row.handle,
        displayName: row.displayName,
        avatarUrl,
        bio: row.bio ?? null,
        reputation: row.reputation,
        joinedAt: row.createdAt,
      });
    }),
  );

  return result;
}

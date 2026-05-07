import { and, eq, ne, or } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npMembers } from "../db/schema/community.js";
import { getMediaUrl } from "../media/url.js";

/**
 * Public-facing member profile. Hand-picked from `np_members` to
 * exclude PII (email, password hash, login attempts, reset tokens,
 * notification prefs, plugin meta) — page authors building public
 * surfaces (`/u/[handle]` etc.) get a safe-to-render shape without
 * having to remember which columns are sensitive.
 *
 * Banned / suspended / deleted members are filtered out — calling
 * `getMemberProfile` for a hidden member returns `null`. The
 * "imported" status (Phase 21 WordPress-import provisional members)
 * IS exposed because those profiles are visible on the public site
 * by design.
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
 *  - the member's status is `suspended` or `deleted` (treat as
 *    "not found" for public surfaces).
 */
export async function getMemberProfile(
  idOrHandle: string,
  options: {
    avatarVariant?: "original" | "thumbnail" | "small" | "medium" | "large" | (string & {});
  } = {},
): Promise<NpMemberProfile | null> {
  if (typeof idOrHandle !== "string" || idOrHandle.length === 0) return null;
  const db = getDb();

  // Match either id or handle in one query — we don't know which
  // form the caller has and a UUID-shape check would fail for
  // imported / synthetic ids that don't match the v4 pattern.
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
    .where(
      and(
        or(eq(npMembers.id, idOrHandle), eq(npMembers.handle, idOrHandle)),
        ne(npMembers.status, "suspended"),
        ne(npMembers.status, "deleted"),
      ),
    )
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

async function getMemberAvatarUrl(
  mediaId: string,
  variant: string,
): Promise<string | null> {
  try {
    return await getMediaUrl(mediaId, { variant });
  } catch {
    // Storage adapter not initialized in this context — non-fatal
    // for profile rendering; just omit the avatar.
    return null;
  }
}

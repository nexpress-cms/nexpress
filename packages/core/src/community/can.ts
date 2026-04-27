import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NxForbiddenError } from "../errors.js";

import { getDb } from "../collections/pipeline.js";
import { nxBans, nxMemberRoles } from "../db/schema/community.js";
import {
  type CommunityCapability,
  type CommunityScope,
  getCommunityRole,
} from "./roles.js";

/**
 * Active-ban probe shared by `memberCan` and direct write-path
 * callers. The community write services (`createComment`,
 * `addReaction`, `fileReport`, `follow`) call `assertNotBanned`
 * straight away — they never went through `memberCan`, so without
 * this gate banned members could still write community content
 * even though their bans were recorded. (#53)
 *
 * Ban-match rules:
 *  - `site` ban → blocks every write.
 *  - `category` / `collection` ban → blocks when the action's scope
 *    chain contains the matching scope.
 *
 * The `or()` helper is required for the `expires_at IS NULL OR
 * expires_at > now` clause; the previous raw `sql` template let
 * Postgres' AND-binds-tighter-than-OR rule re-associate and leak
 * other members' bans (same precedence trap as #006 in 9.5
 * postmortem).
 */
export async function isMemberBanned(
  memberId: string,
  scopes: ReadonlyArray<{ type: CommunityScope; id: string }> = [],
  db?: NodePgDatabase<Record<string, unknown>>,
  now: Date = new Date(),
): Promise<boolean> {
  const handle = db ?? (getDb() as unknown as NodePgDatabase<Record<string, unknown>>);
  const bans = (await handle
    .select({
      scopeType: nxBans.scopeType,
      scopeId: nxBans.scopeId,
    })
    .from(nxBans)
    .where(
      and(
        eq(nxBans.memberId, memberId),
        or(isNull(nxBans.expiresAt), gt(nxBans.expiresAt, now)),
      ),
    )) as Array<{
    scopeType: "site" | "category" | "collection";
    scopeId: string | null;
  }>;

  return bans.some((ban) => {
    if (ban.scopeType === "site") return true;
    return scopes.some((s) => s.type === ban.scopeType && s.id === ban.scopeId);
  });
}

/**
 * Throws `NxForbiddenError` if the member is currently banned for any
 * scope in the chain. Used at the top of community write services
 * before any DB mutation. Pre-existing `memberCan` enforces the same
 * rule for permission-based actions; this helper is the catch-all
 * for write paths that don't go through capability checks.
 */
export async function assertNotBanned(
  memberId: string,
  scopes: ReadonlyArray<{ type: CommunityScope; id: string }> = [],
): Promise<void> {
  if (await isMemberBanned(memberId, scopes)) {
    throw new NxForbiddenError("community", "banned");
  }
}

/**
 * Action a member is attempting. Most actions are real
 * `CommunityCapability` literals — those map 1:1 to a role's
 * capability list. The two exceptions are `"edit-own"` and
 * `"delete-own"`, which short-circuit on ownership without consulting
 * grants at all.
 */
export type MemberAction = CommunityCapability | "edit-own" | "delete-own";

/**
 * Caller-provided context for a permission check. The caller — the
 * comment service, a future thread service, etc. — provides the
 * target's ownership + scope chain rather than `memberCan` looking
 * it up via a polymorphic join. This keeps the resolver decoupled
 * from the per-target table layout, and lets the surface evolve
 * without touching this resolver.
 */
export interface MemberCanTarget {
  /** Free-form target type — `"comment" | "thread" | "reply" | "category" | "report" | "member"`. */
  type: string;
  /** Stable id for logs / future denial reasons. */
  id: string;
  /** Member id of the target's author. Required for own-action checks. */
  ownerId?: string;
  /**
   * Scope chain from most specific to least specific. A reply might
   * provide `[{ type: "thread", id: "<threadId>" }, { type: "category",
   * id: "<categoryId>" }]`; the resolver also checks site-wide grants
   * regardless of what's in the chain.
   */
  scopes?: ReadonlyArray<{ type: CommunityScope; id: string }>;
}

interface MemberCanOptions {
  /** Override the DB handle (tests). Defaults to `getDb()`. */
  db?: NodePgDatabase<Record<string, unknown>>;
  /** Reference time for ban/grant expiry checks. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Returns true when `memberId` is allowed to perform `action` on
 * `target`. Walk order:
 *
 *   1. Active scoped ban → deny everything.
 *   2. `edit-own` / `delete-own` → allow only when `target.ownerId === memberId`.
 *   3. Site-wide grants whose role's capability list includes `action`.
 *   4. Scoped grants matching any element of `target.scopes`, whose role
 *      includes `action`.
 *   5. Otherwise deny.
 *
 * The resolver ignores staff (`nx_users`) entirely. Staff bypass is the
 * caller's responsibility — typically `principalCan(principal, …)` at
 * the API layer, which routes to `memberCan` only when the principal
 * is a member.
 */
export async function memberCan(
  memberId: string,
  action: MemberAction,
  target: MemberCanTarget,
  options: MemberCanOptions = {},
): Promise<boolean> {
  const db = options.db ?? (getDb() as unknown as NodePgDatabase<Record<string, unknown>>);
  const now = options.now ?? new Date();
  const scopes = target.scopes ?? [];

  // Step 1: ban check. Site-wide bans always apply; scoped bans match
  // when the target's scope chain contains the ban's scope.
  const isBanned = await isMemberBanned(memberId, scopes, db, now);
  if (isBanned) return false;

  // Step 2: ownership shortcut for own-content actions.
  if (action === "edit-own" || action === "delete-own") {
    return Boolean(target.ownerId) && target.ownerId === memberId;
  }

  // Step 3+4: walk grants. Pull all of the member's unexpired grants
  // and match them against (the requested action, the target's scope
  // chain). Site-wide grants always match; scoped grants must align
  // with one of the target's scopes.
  const grants = (await db
    .select({
      role: nxMemberRoles.role,
      scopeType: nxMemberRoles.scopeType,
      scopeId: nxMemberRoles.scopeId,
    })
    .from(nxMemberRoles)
    .where(
      and(
        eq(nxMemberRoles.memberId, memberId),
        or(isNull(nxMemberRoles.expiresAt), gt(nxMemberRoles.expiresAt, now)),
      ),
    )) as Array<{
    role: string;
    scopeType: CommunityScope;
    scopeId: string | null;
  }>;

  for (const grant of grants) {
    const def = getCommunityRole(grant.role, grant.scopeType);
    if (!def) continue;
    if (!def.capabilities.includes(action)) continue;

    if (grant.scopeType === "site") {
      return true;
    }
    const matchesTargetScope = scopes.some(
      (s) => s.type === grant.scopeType && s.id === grant.scopeId,
    );
    if (matchesTargetScope) return true;
  }

  return false;
}

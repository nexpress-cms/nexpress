import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { NpForbiddenError } from "../errors.js";

import { getDb } from "../db/runtime.js";
import { npBans, npMemberRoles } from "../db/schema/community.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { type CommunityCapability, type CommunityScope, getCommunityRole } from "./roles.js";

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
  const handle = db ?? getDb();
  // Phase 18 — bans are tenant-scoped. A site-wide ban on
  // tenant A doesn't block writes on tenant B; the ban row
  // includes `site_id` and we filter by the resolver's
  // current value.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const bans = (await handle
    .select({
      scopeType: npBans.scopeType,
      scopeId: npBans.scopeId,
    })
    .from(npBans)
    .where(
      and(
        eq(npBans.memberId, memberId),
        eq(npBans.siteId, siteId),
        or(isNull(npBans.expiresAt), gt(npBans.expiresAt, now)),
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
 * Throws `NpForbiddenError` if the member is currently banned for any
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
    throw new NpForbiddenError("community", "banned");
  }
}

/**
 * Structural enforcement of the ban-check gate (#311). Every
 * community write service should run inside this wrapper — the ban
 * check fires before `fn` and a service author can't accidentally
 * ship a new write path that skips it.
 *
 * Pre-validation that doesn't write (input shape, target lookup
 * existence) can run *before* this call; the gate is specifically
 * for the moment between "we know enough to attempt the write" and
 * the first DB mutation.
 *
 * `scopes` is the same chain `assertNotBanned` accepts — pass
 * `[{ type: "collection", id: targetType }]` for collection-scoped
 * actions, leave empty for site-wide-only enforcement (e.g. follows,
 * polymorphic-target reactions where no obvious scope chain exists).
 */
export async function withMemberWrite<T>(
  memberId: string,
  scopes: ReadonlyArray<{ type: CommunityScope; id: string }>,
  fn: () => Promise<T>,
): Promise<T> {
  await assertNotBanned(memberId, scopes);
  return fn();
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
 * The resolver ignores staff (`np_users`) entirely. Staff bypass is the
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
  const allowed = await memberCapabilities(memberId, [action], target, options);
  return allowed.has(action);
}

/**
 * Resolve several actions with one ban/grant query. Render paths use this to
 * build an exact moderation action set without issuing one database query per
 * button. Own-thread capabilities are implicit for the document owner, which
 * is equivalent to the built-in thread-author role without persisting a grant
 * that can outlive the thread.
 */
export async function memberCapabilities<TAction extends MemberAction>(
  memberId: string,
  actions: readonly TAction[],
  target: MemberCanTarget,
  options: MemberCanOptions = {},
): Promise<Set<TAction>> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const scopes = target.scopes ?? [];
  const requested = new Set<MemberAction>(actions);
  const allowed = new Set<TAction>();

  // Step 1: ban check. Site-wide bans always apply; scoped bans match
  // when the target's scope chain contains the ban's scope.
  const isBanned = await isMemberBanned(memberId, scopes, db, now);
  if (isBanned) return allowed;

  // Step 2: ownership shortcut for own-content actions.
  if (target.ownerId === memberId) {
    for (const action of actions) {
      if (
        action === "edit-own" ||
        action === "delete-own" ||
        action === "edit-own-thread" ||
        action === "lock-own-thread"
      ) {
        allowed.add(action);
      }
    }
  }

  const grantActions = actions.filter(
    (action): action is TAction & CommunityCapability =>
      action !== "edit-own" && action !== "delete-own" && !allowed.has(action),
  );
  if (grantActions.length === 0) return allowed;

  // Step 3+4: walk grants. Pull the member's unexpired grants
  // on the current tenant only — a community-mod on tenant A
  // shouldn't authorize actions on tenant B. Site-wide grants
  // (scope_type='site') still match every action on the
  // resolved tenant.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const grants = (await db
    .select({
      role: npMemberRoles.role,
      scopeType: npMemberRoles.scopeType,
      scopeId: npMemberRoles.scopeId,
    })
    .from(npMemberRoles)
    .where(
      and(
        eq(npMemberRoles.memberId, memberId),
        eq(npMemberRoles.siteId, siteId),
        or(isNull(npMemberRoles.expiresAt), gt(npMemberRoles.expiresAt, now)),
      ),
    )) as Array<{
    role: string;
    scopeType: CommunityScope;
    scopeId: string | null;
  }>;

  for (const grant of grants) {
    const def = getCommunityRole(grant.role, grant.scopeType);
    if (!def) continue;
    const matchesScope =
      grant.scopeType === "site" ||
      scopes.some((scope) => scope.type === grant.scopeType && scope.id === grant.scopeId);
    if (!matchesScope) continue;
    for (const action of grantActions) {
      if (requested.has(action) && def.capabilities.includes(action)) allowed.add(action);
    }
  }

  return allowed;
}

import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxBans, nxMemberRoles } from "../db/schema/community.js";
import {
  type CommunityCapability,
  type CommunityScope,
  getCommunityRole,
} from "./roles.js";

/**
 * Action a member is attempting. Most actions are real
 * `CommunityCapability` literals — those map 1:1 to a role's
 * capability list. The two exceptions are `"edit-own"` and
 * `"delete-own"`, which short-circuit on ownership without consulting
 * grants at all.
 */
export type MemberAction = CommunityCapability | "edit-own" | "delete-own";

/**
 * Caller-provided context for a permission check. The community tables
 * don't all exist yet (only thread / category land in 9.4), so the
 * caller — the comment service, the thread service, etc. — provides
 * the target's ownership + scope chain rather than `memberCan` looking
 * it up via a polymorphic join. This keeps the resolver decoupled from
 * the per-target table layout.
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
  const bans = (await db
    .select({
      scopeType: nxBans.scopeType,
      scopeId: nxBans.scopeId,
      expiresAt: nxBans.expiresAt,
    })
    .from(nxBans)
    .where(
      and(
        eq(nxBans.memberId, memberId),
        sql`${nxBans.expiresAt} is null or ${nxBans.expiresAt} > ${now}`,
      ),
    )) as Array<{
    scopeType: "site" | "category" | "collection";
    scopeId: string | null;
    expiresAt: Date | null;
  }>;

  const isBanned = bans.some((ban) => {
    if (ban.scopeType === "site") return true;
    return scopes.some((s) => s.type === ban.scopeType && s.id === ban.scopeId);
  });
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
        sql`${nxMemberRoles.expiresAt} is null or ${nxMemberRoles.expiresAt} > ${now}`,
      ),
    )) as Array<{
    role: string;
    scopeType: CommunityScope;
    scopeId: string | null;
  }>;

  for (const grant of grants) {
    const def = getCommunityRole(grant.role, grant.scopeType);
    if (!def) continue;
    if (!def.capabilities.includes(action as CommunityCapability)) continue;

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

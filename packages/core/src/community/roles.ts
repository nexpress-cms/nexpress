/**
 * Community role registry. Maps a role name + scope type to the
 * capabilities a grant of that role unlocks. Plugins extend the registry
 * via `registerCommunityRole(...)` (gated by the `members:write` or
 * `community:moderate` capability — enforced at registration time, not
 * here).
 *
 * The capability vocabulary is the single source of truth for "what
 * actions exist in the community." `memberCan()` (../community/can.ts)
 * looks up grants and matches their roles' capability lists against the
 * requested action.
 */

export type CommunityScope = "site" | "category" | "collection" | "thread";

/**
 * Action vocabulary. Adding new actions later is fine, but rename with
 * care — built-in role definitions reference these literals and a
 * silent typo widens permissions instead of narrowing them.
 */
export type CommunityCapability =
  | "hide-comment"
  | "restore-comment"
  | "edit-any-comment"
  | "delete-any-comment"
  | "hide-thread"
  | "restore-thread"
  | "lock-thread"
  | "unlock-thread"
  | "pin-thread"
  | "unpin-thread"
  | "edit-any-thread"
  | "delete-any-thread"
  | "edit-own-thread"
  | "lock-own-thread"
  | "ban-member"
  | "unban-member"
  | "resolve-report"
  | "manage-category"
  | "view-staff-tools";

export interface CommunityRoleDefinition {
  /** e.g. `"category-mod"`. Plugins can ship custom roles like `"tag-mod"`. */
  role: string;
  /** What kind of scope a grant of this role applies to. */
  scopeType: CommunityScope;
  /** Capabilities a grant of this role unlocks within its scope. */
  capabilities: readonly CommunityCapability[];
  /**
   * Human-readable label for admin UIs that surface a role picker. Falls
   * back to `role` when omitted.
   */
  label?: string;
  /** Optional plugin id that registered this role; null for built-ins. */
  source?: string;
}

const ALL_MOD_CAPS: readonly CommunityCapability[] = [
  "hide-comment",
  "restore-comment",
  "edit-any-comment",
  "delete-any-comment",
  "hide-thread",
  "restore-thread",
  "lock-thread",
  "unlock-thread",
  "pin-thread",
  "unpin-thread",
  "edit-any-thread",
  "delete-any-thread",
  "ban-member",
  "unban-member",
  "resolve-report",
  "view-staff-tools",
];

const builtInRoles: CommunityRoleDefinition[] = [
  {
    role: "community-mod",
    scopeType: "site",
    label: "Community moderator",
    capabilities: [...ALL_MOD_CAPS, "manage-category"],
  },
  {
    role: "category-mod",
    scopeType: "category",
    label: "Category moderator",
    capabilities: ALL_MOD_CAPS,
  },
  {
    role: "collection-mod",
    scopeType: "collection",
    label: "Collection moderator",
    // Collection-mods only have authority over the comments under a
    // collection's documents. Thread-only capabilities don't apply, so
    // they're omitted on purpose.
    capabilities: [
      "hide-comment",
      "restore-comment",
      "edit-any-comment",
      "delete-any-comment",
      "ban-member",
      "unban-member",
      "resolve-report",
      "view-staff-tools",
    ],
  },
  {
    role: "thread-author",
    scopeType: "thread",
    label: "Thread author",
    // Auto-granted on thread create. Lets the OP edit / lock their own
    // thread without giving them broader powers.
    capabilities: ["edit-own-thread", "lock-own-thread"],
  },
];

const customRoles: CommunityRoleDefinition[] = [];

function key(role: string, scopeType: CommunityScope): string {
  return `${scopeType}:${role}`;
}

/**
 * Plugins call this from setup() to add their own role kinds. Throws
 * when the (role, scopeType) pair is already registered to keep the
 * registry deterministic — a plugin overriding a built-in role would
 * silently widen permissions and is almost always a mistake.
 */
export function registerCommunityRole(definition: CommunityRoleDefinition): void {
  const composite = key(definition.role, definition.scopeType);
  if (
    builtInRoles.some((b) => key(b.role, b.scopeType) === composite) ||
    customRoles.some((c) => key(c.role, c.scopeType) === composite)
  ) {
    throw new Error(
      `[community] role "${definition.role}" already registered for scope "${definition.scopeType}".`,
    );
  }
  customRoles.push({ ...definition });
}

/** Look up a role by `(role, scopeType)`. Returns undefined when unknown. */
export function getCommunityRole(
  role: string,
  scopeType: CommunityScope,
): CommunityRoleDefinition | undefined {
  const composite = key(role, scopeType);
  return (
    builtInRoles.find((b) => key(b.role, b.scopeType) === composite) ??
    customRoles.find((c) => key(c.role, c.scopeType) === composite)
  );
}

/**
 * Returns every role currently registered, built-ins first then
 * plugin-defined. Used by the admin role picker to render selectable
 * options for a given scope.
 */
export function listCommunityRoles(scopeType?: CommunityScope): CommunityRoleDefinition[] {
  const all = [...builtInRoles, ...customRoles];
  return scopeType ? all.filter((r) => r.scopeType === scopeType) : all;
}

/** Tests reset state between cases; production callers should never need this. */
export function resetCommunityRoles(): void {
  customRoles.length = 0;
}

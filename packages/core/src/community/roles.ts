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

import {
  npRequireCommunityRoleCatalog,
  npRequireCommunityRoleDefinition,
} from "../community-contract/contract.js";
import type {
  CommunityCapability,
  CommunityRoleDefinition,
  CommunityScope,
} from "../community-contract/types.js";

import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";

export type { CommunityCapability, CommunityRoleDefinition, CommunityScope };

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
    // Collection-mods can moderate comments and triage reports under a
    // collection. Thread-state capabilities stay omitted, so a report may be
    // dismissed but cannot be used to mutate the document itself.
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
    // `memberCapabilities()` applies these capabilities implicitly when
    // target.ownerId matches the caller. An explicit scoped grant remains a
    // deliberate edit/lock delegation and doctor checks that target's life.
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
  let checked: CommunityRoleDefinition;
  try {
    checked = npRequireCommunityRoleDefinition(definition);
  } catch (error) {
    npRecordCommunityRuntimeDiagnostic(
      "roles",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  const composite = key(checked.role, checked.scopeType);
  if (
    builtInRoles.some((b) => key(b.role, b.scopeType) === composite) ||
    customRoles.some((c) => key(c.role, c.scopeType) === composite)
  ) {
    const error = new Error(
      `[community] role "${definition.role}" already registered for scope "${definition.scopeType}".`,
    );
    npRecordCommunityRuntimeDiagnostic("roles", error.message);
    throw error;
  }
  customRoles.push({ ...checked, capabilities: [...checked.capabilities] });
}

/** Look up a role by `(role, scopeType)`. Returns undefined when unknown. */
export function getCommunityRole(
  role: string,
  scopeType: CommunityScope,
): CommunityRoleDefinition | undefined {
  const composite = key(role, scopeType);
  const found =
    builtInRoles.find((b) => key(b.role, b.scopeType) === composite) ??
    customRoles.find((c) => key(c.role, c.scopeType) === composite);
  return found ? { ...found, capabilities: [...found.capabilities] } : undefined;
}

/**
 * Returns every role currently registered, built-ins first then
 * plugin-defined. Used by the admin role picker to render selectable
 * options for a given scope.
 */
export function listCommunityRoles(scopeType?: CommunityScope): CommunityRoleDefinition[] {
  const all = [...builtInRoles, ...customRoles];
  const selected = scopeType ? all.filter((r) => r.scopeType === scopeType) : all;
  return npRequireCommunityRoleCatalog(selected).map((role) => ({
    ...role,
    capabilities: [...role.capabilities],
  }));
}

/** Tests reset state between cases; production callers should never need this. */
export function resetCommunityRoles(): void {
  customRoles.length = 0;
}

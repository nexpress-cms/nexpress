import { type NxAuthUser } from "../config/types.js";
import { can } from "../auth/capabilities.js";

import { memberCan } from "./can.js";
import type { MemberAction, MemberCanTarget } from "./can.js";

/**
 * Unified permission check. Staff routes pass `{ kind: "staff", user }`;
 * member routes pass `{ kind: "member", memberId }`. Staff with
 * `admin`, `editor`, or `moderator` role short-circuit to allow all
 * community-mod actions — they're trusted by virtue of being CMS
 * staff. Other staff roles (author, viewer) and members fall through
 * to the member-side resolver, which checks role grants in
 * `nx_member_roles`.
 *
 * `edit-own` / `delete-own` actions still require ownership even for
 * staff — the API layer should already check ownership for self-only
 * routes, but the ownership rule here is belt-and-braces.
 */
export type Principal =
  | { kind: "staff"; user: NxAuthUser }
  | { kind: "member"; memberId: string };

export async function principalCan(
  principal: Principal,
  action: MemberAction,
  target: MemberCanTarget,
): Promise<boolean> {
  // Owner-only actions: stay strict. A staff user can't `edit-own`
  // a row they don't own; that branch is for owner-self editing.
  // Mod-style "edit somebody else's content" goes through
  // `edit-any-comment` etc., which staff bypasses below.
  const ownerOnly = action === "edit-own" || action === "delete-own";

  switch (principal.kind) {
    case "staff":
      // Staff don't own member-authored content. Owner-only
      // shortcuts are denied to staff outright; non-owner-only
      // actions short-circuit on community.moderate.
      if (ownerOnly) return false;
      return can(principal.user, "community.moderate");
    case "member":
      return memberCan(principal.memberId, action, target);
    default: {
      // Exhaustiveness check — adding a new Principal kind
      // without handling it here is a compile error.
      const _exhaustive: never = principal;
      void _exhaustive;
      return false;
    }
  }
}

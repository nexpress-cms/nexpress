import { isStaffMod, type NxAuthUser } from "../config/types.js";

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
  if (action === "edit-own" || action === "delete-own") {
    if (principal.kind === "staff") {
      // Staff don't own member-authored content; this branch is only
      // reachable when a member uses an owner-shortcut action they
      // shouldn't have access to. Deny.
      return false;
    }
    return memberCan(principal.memberId, action, target);
  }

  if (principal.kind === "staff") {
    return isStaffMod(principal.user);
  }

  return memberCan(principal.memberId, action, target);
}

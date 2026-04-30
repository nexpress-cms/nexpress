import type { NxAuthUser } from "../config/types.js";

/**
 * Capability-based authorization (#273).
 *
 * The legacy model exposes two parallel role-check primitives:
 *
 *   - `hasRole(user, minRole)`  — linear comparison along
 *                                 viewer < author < editor < admin.
 *                                 `moderator` is intentionally absent
 *                                 from the hierarchy.
 *   - `isStaffMod(user)`        — admin | editor | moderator
 *                                 (community-moderation axis).
 *
 * Call sites have to remember which axis applies to the action they're
 * gating, and a `hasRole(user, "editor")` check that should have
 * included moderators silently drops them. `can(user, capability)`
 * names the *behavior* instead of the role hierarchy, so a reviewer
 * spots `can(user, "community.moderate")` on a comment-mod path
 * regardless of how the role table evolves later.
 *
 * This module is the new entry point. The legacy `hasRole` /
 * `isStaffMod` exports remain for backwards compatibility while the
 * existing 130+ call sites migrate to `can()`.
 *
 * Capability vocabulary:
 *   - `content.publish`    — change publication state on staff-owned
 *                            content. Editor or admin.
 *   - `content.author`     — create / edit content. Author, moderator,
 *                            editor, or admin (moderators get author-
 *                            level write access in this model so they
 *                            can leave moderation notes / pinned
 *                            replies on the content surface).
 *   - `community.moderate` — comment hide/restore, report triage, ban
 *                            operations. Admin, editor, or moderator.
 *   - `admin.manage`       — admin-only surfaces (site CRUD,
 *                            super-admin-adjacent settings).
 *
 * Add new capabilities by extending the union AND the exhaustive
 * switch below — TypeScript will surface the missing branch.
 */
export type NxCapability =
  | "content.publish"
  | "content.author"
  | "community.moderate"
  | "admin.manage";

export function can(
  user: NxAuthUser | null | undefined,
  capability: NxCapability,
): boolean {
  if (!user) return false;
  switch (capability) {
    case "content.publish":
      return user.role === "admin" || user.role === "editor";
    case "content.author":
      return (
        user.role === "admin" ||
        user.role === "editor" ||
        user.role === "author" ||
        user.role === "moderator"
      );
    case "community.moderate":
      return (
        user.role === "admin" ||
        user.role === "editor" ||
        user.role === "moderator"
      );
    case "admin.manage":
      return user.role === "admin";
    default: {
      // Exhaustiveness check — adding a capability without handling
      // it here is a compile error.
      const _exhaustive: never = capability;
      void _exhaustive;
      return false;
    }
  }
}

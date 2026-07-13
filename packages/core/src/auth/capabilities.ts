import type { NpAuthUser } from "../config/types.js";

/**
 * Capability-based authorization (#273).
 *
 * Replaced the previous parallel `hasRole(user, minRole)` /
 * `isStaffMod(user)` model. Naming the *behavior* instead of a role
 * hierarchy means a reviewer spots `can(user, "community.moderate")`
 * on a comment-mod path regardless of how the role table evolves
 * later — and the previous trap where a `hasRole(user, "editor")`
 * check silently dropped moderators is gone by construction.
 *
 * Capability vocabulary:
 *   - `site.access`       — select a site as the active execution
 *                            context. Any authenticated staff role.
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
export type NpCapability =
  "site.access" | "content.publish" | "content.author" | "community.moderate" | "admin.manage";

export function can(user: NpAuthUser | null | undefined, capability: NpCapability): boolean {
  if (!user) return false;
  switch (capability) {
    case "site.access":
      return true;
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
      return user.role === "admin" || user.role === "editor" || user.role === "moderator";
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

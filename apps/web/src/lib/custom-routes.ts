import { registerCustomRoute } from "@nexpress/core/routes";

/**
 * Register every hand-coded Next.js route under `app/(site)/*` that
 * an operator might want to discover from the admin (Settings →
 * Routes) or link to from the navigation editor. The catch-all
 * `[[...slug]]` is excluded — that's CMS pages, surfaced through
 * the Pages collection. Dynamic routes (`/u/[handle]`,
 * `/blog/[slug]`, …) are also excluded because a literal href can't
 * be derived without input.
 *
 * Adding a route here is a manual, intentional act: the framework
 * has no filesystem scanner and shouldn't grow one (Next's routing
 * is too expressive — route groups, parallel routes, intercepting
 * routes — for a static manifest to stay honest).
 */
export function registerCustomRoutes(): void {
  registerCustomRoute({
    path: "/blog",
    label: "Blog",
    description: "Blog index page",
    icon: "newspaper",
    group: "content",
  });
  registerCustomRoute({
    path: "/search",
    label: "Search",
    description: "Site-wide search results",
    icon: "search",
    group: "content",
  });
  registerCustomRoute({
    path: "/discussions",
    label: "Discussions",
    description: "Community discussion index",
    icon: "messages-square",
    group: "community",
  });
  registerCustomRoute({
    path: "/discussions/new",
    label: "New discussion",
    description: "Create a new discussion thread",
    icon: "square-pen",
    group: "community",
  });
  registerCustomRoute({
    path: "/members/login",
    label: "Sign in",
    description: "Member sign-in page",
    icon: "log-in",
    group: "auth",
  });
  registerCustomRoute({
    path: "/members/register",
    label: "Register",
    description: "Member registration page",
    icon: "user-plus",
    group: "auth",
  });
  registerCustomRoute({
    path: "/members/me/notifications",
    label: "My notifications",
    description: "Signed-in member's notification preferences",
    icon: "circle-user",
    group: "auth",
  });
  registerCustomRoute({
    path: "/members/forgot-password",
    label: "Forgot password",
    description: "Member password-reset request",
    icon: "log-in",
    group: "auth",
  });
  registerCustomRoute({
    path: "/members/reset-password",
    label: "Reset password",
    description: "Member password-reset confirmation",
    icon: "log-in",
    group: "auth",
  });
  registerCustomRoute({
    path: "/members/verify",
    label: "Verify email",
    description: "Member email-verification landing page",
    icon: "log-in",
    group: "auth",
  });
}

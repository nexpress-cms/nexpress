import { npDefineCustomRoutes } from "@nexpress/core/routes";

/**
 * Framework-provided routes included in every generated site's code-owned
 * catalog. Consumer apps compose these with their own definitions in
 * `src/lib/custom-routes.ts`; the app bootstrap registers that complete array
 * as one source-owned snapshot.
 */
export const npDefaultCustomRoutes = npDefineCustomRoutes([
  {
    path: "/blog",
    label: "Blog",
    description: "Blog index page",
    icon: "newspaper",
    group: "content",
  },
  {
    path: "/blog/[slug]",
    label: "Blog post",
    description: "Individual blog post",
    icon: "newspaper",
    group: "content",
  },
  {
    path: "/blog/category/[slug]",
    label: "Blog category",
    description: "Filtered blog category",
    icon: "newspaper",
    group: "content",
  },
  {
    path: "/search",
    label: "Search",
    description: "Site-wide search results",
    icon: "search",
    group: "content",
  },
  {
    path: "/boards",
    label: "Boards",
    description: "Community board index",
    icon: "messages-square",
    group: "community",
  },
  {
    path: "/boards/[boardKey]/new",
    label: "New forum post",
    description: "Create a post in a community board",
    icon: "square-pen",
    group: "community",
  },
  {
    path: "/members/login",
    label: "Sign in",
    description: "Member sign-in page",
    icon: "log-in",
    group: "auth",
  },
  {
    path: "/members/register",
    label: "Register",
    description: "Member registration page",
    icon: "user-plus",
    group: "auth",
  },
  {
    path: "/members/me/notifications",
    label: "My notifications",
    description: "Signed-in member's notification inbox and settings",
    icon: "circle-user",
    group: "auth",
  },
  {
    path: "/members/forgot-password",
    label: "Forgot password",
    description: "Member password-reset request",
    icon: "log-in",
    group: "auth",
  },
  {
    path: "/members/reset-password",
    label: "Reset password",
    description: "Member password-reset confirmation",
    icon: "log-in",
    group: "auth",
  },
  {
    path: "/members/verify",
    label: "Verify email",
    description: "Member email-verification landing page",
    icon: "log-in",
    group: "auth",
  },
  {
    path: "/u/[handle]",
    label: "Member profile",
    description: "Public member profile",
    icon: "circle-user",
    group: "community",
  },
]);

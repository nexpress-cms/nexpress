# Theme & custom-page author cookbook

This is the recipe book for two adjacent jobs:

- Authoring a **custom Next.js page** that lives under
  `src/app/(site)/*` (in a scaffolded site; the same physical
  location in `apps/web/src/app/(site)/*` for the reference app)
  and ships as part of your site code (`/blog`, `/search`,
  `/u/[handle]`, …).
- Authoring a **theme package** (`packages/themes/<name>` or your
  own npm package) that contributes `<Shell>`, slots, and per-
  collection templates.

Both jobs run **server-side** in Next's App Router and call the
same set of `@nexpress/core` helpers. The audience for this doc is
"someone who knows React + Next.js but doesn't yet know the
NexPress data layer." If you're authoring a plugin instead, see
[`plugin-quickstart.md`](plugin-quickstart.md) — the surface
is different (you're shipping behavior, not pages).

The companion docs:

- [`AGENTS.md`](../AGENTS.md) — architectural overview + v0.1
  stability contract (what the symbols below promise).
- [`theme-authoring.md`](theme-authoring.md) — the `defineTheme`
  contract, shell / slots / templates, dark mode, registering
  and activating a theme. **Read that first if you're shipping a
  theme.** This doc is the "what helpers do I call from inside the
  theme" companion.
- [`i18n.md`](i18n.md) — i18n setup (configuring locales).
- [`caching.md`](caching.md) — what's cached and what isn't, plus
  `revalidateCollection`.

---

## Table of contents

1. [Bootstrap — the one line every page needs](#1-bootstrap)
2. [Reading content](#2-reading-content)
3. [Media & images](#3-media--images)
4. [Settings & navigation](#4-settings--navigation)
5. [i18n & localization](#5-i18n--localization)
6. [Auth — current user / member](#6-auth)
7. [Plugins — detection & config](#7-plugins)
8. [Member profiles](#8-member-profiles)
9. [Theme tokens & active theme](#9-theme-tokens)
10. [Block & rich-text rendering](#10-block-rendering)
11. [SEO — metadata, sitemap, JSON-LD, feeds](#11-seo)
12. [Pagination](#12-pagination)
13. [What NOT to import from a theme / page](#13-anti-patterns)
14. [Where to ask for new helpers](#14-feedback)

---

## 1. Bootstrap

Every server route or RSC that touches `@nexpress/core` data must
call `ensureFor(intent)` first. Without it, `getDb()` throws
`"Database not initialized"` and the request 500s.

```ts
// src/app/(site)/blog/page.tsx (in a scaffolded site, or the same
// physical location under `apps/web/` in the monorepo).
import { ensureFor } from "@/lib/init-core";

export default async function BlogIndex() {
  await ensureFor("read");
  // ...now safe to call findDocuments / getMediaUrl / etc.
}
```

The three intents:

| Intent      | Use when                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------- |
| `"read"`    | Read-only RSC pages and `GET` API routes (most of this guide).                            |
| `"plugins"` | When render needs `runHook` to fire (block / site pages with plugin-augmented rendering). |
| `"write"`   | Mutating routes / server actions / import scripts.                                        |

Custom pages are almost always `"read"`. Use `"plugins"` if your
page renders blocks that plugins extend.

---

## 2. Reading content

| Symbol                                     | Use for                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `getPageBySlug(slug, { draft?, locale? })` | One CMS page document (`pages` collection).                        |
| `getPostBySlug(slug, { draft? })`          | One post document (`posts` collection).                            |
| `getDocumentById(collection, id)`          | Any document by id, any collection.                                |
| `findDocuments(collection, options)`       | Listing with `where`, `sort`, `page`, `limit`, `locale`, `search`. |
| `findPosts(options)`                       | Sugar over `findDocuments("posts", options)`.                      |
| `getAllPageSlugs()`                        | Static path generation.                                            |
| `findSlugRedirect(oldSlug)`                | Resolve a historic slug → `{ slug, status }`.                      |
| `searchCollections({ q, limit, ... })`     | Full-text search with facets and optional relevance scores.        |

> `getPageBySlug` / `getPostBySlug` / `findPosts` /
> `getAllPageSlugs` are convenience helpers hardcoded to the
> `pages` and `posts` collections and return
> `Record<string, unknown>` — fields require casts at the read
> site. For typed reads, see [§2.1](#21-typed-reads-recommended).

All from `@nexpress/core`.

### 2.1 Typed reads (recommended)

`pnpm db:generate` emits `apps/<app>/src/db/generated/documents.ts`
alongside the Drizzle schema. The file declares one
`${Pascal}Document` interface per collection plus `find${Pascal}`
and `get${Pascal}Document` wrappers that bind the type generic so
your call sites don't have to:

```ts
// app/(site)/u/[handle]/discussions/page.tsx
import { findDiscussions } from "@/db/generated/documents";

const result = await findDiscussions({
  where: { memberAuthorId: profile.id, status: "published" },
  sort: "-createdAt",
  page: pageNum,
  limit: 20,
});

result.docs.map((doc) => (
  <li key={doc.id}>
    <a href={`/discussions/${doc.slug}`}>{doc.title}</a>
    <time>{doc.createdAt.toLocaleDateString()}</time>
  </li>
));
```

No `as string` / `as Date` casts. The `where` clause is
`Partial<DiscussionsDocument>` — typo on a field name (e.g.
`memberAutorId`) is a compile error, not a silent 0-result query.

System-level filters (`siteId`, `visibility`, `locale`) live on
the where clause too without being collection fields — they're
declared on `NpFindWhereSystemTokens` and merged into the typed
shape. So this works:

```ts
import type { NpFindWhere } from "@nexpress/core";
import type { DiscussionsDocument } from "@/db/generated/documents";

const where: NpFindWhere<DiscussionsDocument> = {
  memberAuthorId: member.id, // typed (collection field)
  visibility: "*", // typed (system token)
};
```

The untyped `findDocuments(slug, options)` from `@nexpress/core`
still works for back-compat (and stays the right call when you
genuinely need an untyped escape hatch — e.g. building admin
tooling that doesn't know which collections exist at compile
time). Default consumers should reach for the generated typed
wrappers.

```ts
// app/(site)/blog/page.tsx
import { getCurrentLocale } from "@nexpress/core/i18n";
import { ensureFor } from "@/lib/init-core";
import { findPosts } from "@/db/generated/documents";

export default async function BlogIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await ensureFor("read");
  const { page = "1" } = await searchParams;
  const result = await findPosts({
    page: Number(page),
    limit: 20,
    locale: getCurrentLocale({ pathname: "/blog" }),
  });
  return (
    <ul>
      {result.docs.map((post) => (
        <li key={post.id}>
          <a href={`/blog/${post.slug}`}>{post.title}</a>
        </li>
      ))}
    </ul>
  );
}
```

```ts
// app/(site)/blog/[slug]/page.tsx
import { getPostBySlug } from "@nexpress/core";
import { notFound } from "next/navigation";
import { ensureFor } from "@/lib/init-core";

export default async function BlogPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await ensureFor("read");
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();
  return <article>{/* render post */}</article>;
}
```

### When draft preview is needed

The catch-all uses `draftMode()` to flip into preview rendering;
copy that pattern when your custom page should respect the same
flag:

```ts
import { draftMode } from "next/headers";
const { isEnabled: preview } = await draftMode();
const post = await getPostBySlug(slug, { draft: preview });
```

### Filtering by `hasMany` relationships

A `hasMany` relationship like `posts.categories` lives in a
join table (`np_c_posts__categories`) — there's no `categories`
column on `np_c_posts`. As of Phase E, the codegen-emitted
typed wrappers handle the join transparently:

```ts
import { findPosts } from "@/db/generated/documents";

// Single target — natural one-category-page case.
const result = await findPosts({
  where: { status: "published", categories: category.id },
  sort: "-publishedAt",
  page: pageNum,
  limit: 20,
});

// Array — OR semantics across multiple targets.
const wide = await findPosts({
  where: { tags: [tagA.id, tagB.id, tagC.id] },
});

// Multiple hasMany filters — AND across categories AND tags.
const both = await findPosts({
  where: { categories: catId, tags: tagId },
});
```

The wrapper subqueries the join table for matching parent ids,
intersects across multiple hasMany filters, and delegates to
`findDocuments` with `id: idList`. **All the gates findDocuments
applies — `siteId`, `visibility`, `access.read` — run as usual.**
You shouldn't need raw Drizzle for the standard listing path.

Reference implementation: `@nexpress/app/site/blog/category/[slug]/page` (re-exported by the thin wrapper at `apps/web/src/app/(site)/blog/category/[slug]/page.tsx`).

#### When you still need raw Drizzle

The wrapper covers the join-table case. For more exotic shapes
— full-text search ranking, JSON-column queries, custom CTEs —
you still drop into Drizzle directly. Just remember to re-apply
the `findDocuments` gates manually:

- `eq(table.siteId, await getCurrentSiteId() ?? "default")`
- `eq(table.visibility, "public")` for anonymous viewers
- `access.read` callbacks have no equivalent in raw queries —
  collections that gate on the current user must go through
  `findDocuments`, full stop.

---

## 3. Media & images

```ts
import { getMediaById, getMediaUrl } from "@nexpress/core/media";

// Resolve a media id (from a document field) to a public URL.
const heroUrl = await getMediaUrl(post.heroImageId);
// Sized variant for thumbnails / cards.
const cardUrl = await getMediaUrl(post.heroImageId, { variant: "medium" });
// Fall back to null instead of the original if the variant is missing.
const ogUrl = await getMediaUrl(post.heroImageId, {
  variant: "og",
  fallbackToOriginal: false,
});
```

Built-in variant names: `"original"` (default), `"thumbnail"`
(300px), `"small"` (600px), `"medium"` (900px), `"large"`
(1400px), `"xlarge"` (1920px), `"og"` (1200×630, cropped).
Plugin-defined custom variants are accepted as plain strings —
the lookup walks the validated `media.sizes` map regardless. Variant URLs are
resolved from each entry's actual `storageKey`; the renderer never guesses a
file extension. Returns `null` for unknown / soft-deleted ids. See
[media.md](media.md) for the exact persisted and API contracts.

If you also need the dimensions, alt text, or filename, fetch the
record first:

```ts
const media = await getMediaById(post.heroImageId);
if (media) {
  const url = await getMediaUrl(media.id, { variant: "large" });
  return <img src={url ?? ""} alt={media.alt ?? ""} width={media.width} height={media.height} />;
}
```

`getMediaById()` returns a validated `NpMediaRecord`. Malformed persisted
variant metadata, focal points, captions, uploader ownership, or dimensions
fail closed before a theme receives the row.

---

## 4. Settings & navigation

```ts
import { getSetting, getNavigation } from "@nexpress/core";
import type { NpResolvedNavItem } from "@nexpress/core/navigation";

// Site identity
const site = await getSetting<{ name: string; url: string }>("site");
const description = await getSetting<string>("description");

// Navigation menus by location slug
const header: NpResolvedNavItem[] = await getNavigation("header");
const footer = await getNavigation("footer");
```

`getSetting` is generic — pass the expected shape as the type
parameter. The framework doesn't validate; you should wrap with a
Zod parse if the shape is plugin-controlled.

`getNavigation` validates the stored tree and returns resolved items (with
`children: NpResolvedNavItem[]` for nested items). Every item has a concrete
`url`; `type: "link" | "page" | "collection"` preserves its source kind. The
location slug is whatever the operator created in **Settings → Navigation**.
Built-ins: `"header"`, `"footer"`, `"main"`. Use `NpNavItem` only for stored
or authored payloads. See [`navigation.md`](navigation.md) for the exact wire
union, bounds, URL policy, and validation API.

The navigation editor's **link** type can autocomplete from the
custom-routes registry — make sure your hand-coded routes are
registered (see [§4.1](#4-1-register-your-hand-coded-routes)) so
operators can pick them from a dropdown.

### 4.1 Register your hand-coded routes

```ts
// src/lib/custom-routes.ts (a new file you author inside your site —
// not a framework wrapper).
import { registerCustomRoute } from "@nexpress/core/routes";

export function registerCustomRoutes(): void {
  registerCustomRoute({
    path: "/blog",
    label: "Blog",
    description: "Blog index page",
    icon: "newspaper",
    group: "content",
  });
  // Add one entry per navigable static route. Skip dynamic ones
  // (`/u/[handle]`) — they don't appear as nav-link targets.
}
```

Call `registerCustomRoutes()` once at boot — unwrap your site's
`src/lib/init-core.ts` (a thin re-export of
`@nexpress/app/lib/init-core` by default) and call it inside
`ensureFor("read")` before re-exporting.
The routes show up in **Settings → Routes** for operators and as
autocomplete in the navigation editor's link picker.

---

## 5. i18n & localization

```ts
import { resolveLocale, getCurrentLocale, t, tSync } from "@nexpress/core/i18n";

// Inside an RSC, headers() gives you both signals
import { headers } from "next/headers";

const headerList = await headers();
const pathname = headerList.get("x-np-pathname") ?? "/"; // stamped by the framework proxy (`src/proxy.ts`, implementation in `@nexpress/app/proxy`)
const acceptLanguage = headerList.get("accept-language") ?? undefined;

const resolved = resolveLocale({ pathname, acceptLanguage });
// resolved → { locale: "ko", source: "path", pathnameWithoutLocale: "/blog" } | null
```

Or the simpler form when you only need the string:

```ts
const locale = getCurrentLocale({ pathname }); // always returns a string
```

Resolution order: pathname prefix (`/ko/blog`) → `Accept-Language`
header → site default. `resolveLocale` returns `null` only when
i18n isn't configured for the site (treat that as "monolingual,
ignore locale entirely"). `getCurrentLocale` always returns a
string with `"en"` as a hard fallback.

Translation lookup once you have the locale:

```ts
const greeting = await t("home.hero.title", locale, { name: "Friend" });
// or synchronously when you know the bundle is loaded
const fallback = tSync("home.hero.fallback", locale);
```

> **About `x-np-pathname`:** Next doesn't expose the raw pathname
> from `headers()` by default. The reference app's `proxy.ts`
> stamps `x-np-pathname` on every request — copy that pattern if
> your app uses a different proxy. Inside the catch-all
> `[[...slug]]`, you can also derive the path from the
> `params.slug` array.

---

## 6. Auth

Three flavors of "current user," depending on what you need:

| Helper                  | Returns                          | When                                                                                              |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `requireAuth(request)`  | `NpAuthUser` (throws on absence) | Staff-gated **API routes** (need a `NextRequest`). From the per-app `createAuthHelpers()` output. |
| `optionalAuth(request)` | `NpAuthUser \| null`             | API routes that render differently for staff but don't require it.                                |
| `getSiteMember()`       | `NpMemberAuthRow \| null`        | RSC pages that show member-only content. App-level helper around `optionalMember(request)`.       |

API routes get the request directly:

```ts
// app/api/posts/draft/route.ts
import { NpForbiddenError } from "@nexpress/core";
import { can } from "@nexpress/core/auth";
import { requireAuth } from "@/lib/auth-helpers";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!can(user, "content.author")) {
    throw new NpForbiddenError("posts", "draft");
  }
  // ...
}
```

RSC pages don't have a `NextRequest`; reach for `getSiteMember()`
(an app-level wrapper that pulls the cookie out of `cookies()`)
and `redirect()` manually if the page is gated:

```tsx
// app/(site)/members/me/notifications/page.tsx
import { redirect } from "next/navigation";
import { getSiteMember } from "@/lib/site-member";
import { ensureFor } from "@/lib/init-core";

export default async function NotificationSettings() {
  await ensureFor("read");
  const member = await getSiteMember();
  if (!member) redirect("/members/login?next=/members/me/notifications");
  return <h1>Welcome, @{member.handle}</h1>;
}
```

Capability checks for staff routes use `can(user, capability)`
from `@nexpress/core/auth`:

```ts
import { NpForbiddenError } from "@nexpress/core";
import { can } from "@nexpress/core/auth";
const user = await requireAuth(request);
if (!can(user, "admin.manage")) throw new NpForbiddenError("settings", "view");
```

Capability strings are stable in v0.1 — see `AGENTS.md`'s
**Stability** section.

### 6.1 Member auth pages — framework-owned

Sites typically need login / register / forgot-password / reset-
password / verify-email / OAuth flows. The framework ships
`@nexpress/auth-pages` so each route file is two lines and
each page is a hook + your own JSX.

**Routes** — bootstrap once, mount everywhere:

```ts
// apps/<app>/src/lib/auth-routes.ts
import { createMemberAuthRoutes } from "@nexpress/auth-pages/server";
import { getDb } from "@/lib/bootstrap";
import { ensureFor, nexpressConfig } from "@/lib/init-core";
import {
  clearMemberAuthCookies,
  getMemberAuthRuntimeConfig,
  requireMember,
  setMemberAuthCookies,
} from "@/lib/member-auth-helpers";

export const memberAuthRoutes = createMemberAuthRoutes({
  getDb,
  ensureFor,
  authHelpers: {
    setMemberAuthCookies,
    clearMemberAuthCookies,
    getMemberAuthRuntimeConfig,
    requireMember,
  },
  site: { name: nexpressConfig.site.name, url: process.env.SITE_URL ?? null },
});
```

```ts
// app/api/members/login/route.ts
import { memberAuthRoutes } from "@/lib/auth-routes";
export const POST = memberAuthRoutes.login;
```

The factory returns 12 handlers covering every flow: `login`,
`register`, `logout`, `refresh`, `verifyEmail`, `forgotPassword`,
`resetPassword`, `oauthStart`, `oauthCallback`, `meGet`,
`mePatch`, `meDelete`. Each one is a `(request, ctx?) =>
Promise<NextResponse>` you re-export as the route file's HTTP
verb.

**Hooks** — headless React hooks for the page side:

```tsx
// apps/<app>/src/components/login-form.tsx
"use client";
import { useMemberLogin } from "@nexpress/auth-pages/client";
import { useRouter } from "next/navigation";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const { fields, errors, isSubmitting, submit } = useMemberLogin({
    onSuccess: () => router.push(next),
  });
  return (
    <form onSubmit={submit}>
      <input type="email" {...fields.email} />
      {errors.email && <p>{errors.email}</p>}
      <input type="password" {...fields.password} />
      {errors.password && <p>{errors.password}</p>}
      {errors._form && <p>{errors._form}</p>}
      <button disabled={isSubmitting}>Sign in</button>
    </form>
  );
}
```

Six hooks cover the six form pages: `useMemberLogin`,
`useMemberRegister`, `useMemberForgotPassword`,
`useMemberResetPassword`, `useMemberVerifyEmail`,
`useMemberLogout`. Each returns `{ fields, errors, isSubmitting,
isSuccess, submit }` (verify is auto-on-mount, logout has no
form).

**Customization knobs** — every hook accepts `{ endpoint?,
messages?, onSuccess?, onError? }`. The `messages` option
overrides user-facing strings per error code:

```tsx
useMemberLogin({
  messages: {
    INVALID_CREDENTIALS: "이메일 또는 비밀번호가 올바르지 않습니다.",
    NETWORK: "네트워크 오류. 다시 시도해주세요.",
  },
});
```

Untouched codes fall back to the framework default (English).
The full code list:
`INVALID_CREDENTIALS | ACCOUNT_LOCKED | REGISTRATION_DISABLED |
VALIDATION | RATE_LIMITED | TOKEN_INVALID | TOKEN_EXPIRED |
NETWORK | SERVER_ERROR | UNAUTHORIZED`.

**What still belongs to your app** — the JSX, copy, OAuth
provider list, `safeNext` policy, email templates, and the page
shells (`app/(site)/members/login/page.tsx` etc., which decide
when to redirect already-signed-in users, what success banners
to show on `?verified=1`, etc.). The framework owns the wire
protocol; sites own the experience.

### 6.2 OAuth providers

`@nexpress/oauth-providers` ships factory functions for the most
common providers — Google, GitHub, Discord. Each takes
`{ clientId, clientSecret }` and returns an `OAuthProvider`
ready for `registerOAuthProvider()`:

```ts
import { registerOAuthProvider } from "@nexpress/core/auth";
import { createGoogleOAuthProvider, createDiscordOAuthProvider } from "@nexpress/oauth-providers";

if (process.env.NP_OAUTH_GOOGLE_CLIENT_ID && process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET) {
  registerOAuthProvider(
    createGoogleOAuthProvider({
      clientId: process.env.NP_OAUTH_GOOGLE_CLIENT_ID,
      clientSecret: process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET,
    }),
  );
}
```

Each provider strictly honors `email_verified` (Google, Discord)
or falls back to `/user/emails` for verified primary (GitHub).
**Unverified emails never reach the framework's email-match
identity-resolution path** — that closes a hijack vector where
an attacker controlling an OAuth account with a victim's email
could otherwise claim the victim's NexPress account.

The bundled `@nexpress/plugin-oauth-google` and
`@nexpress/plugin-oauth-github` packages are thin wrappers
around the factories. They are included in the default scaffold
plugin list and read credentials from either env
(`NP_OAUTH_<PROVIDER>_CLIENT_ID` +
`NP_OAUTH_<PROVIDER>_CLIENT_SECRET`) or the admin plugin
auto-form. Env wins on a tie; partial env is treated as a
misconfiguration. The GitHub wrapper also declares a single login
Audience (`staff` by default, or `member`) because GitHub OAuth Apps
accept one callback URL. Sites that want registration in their own
boot code can still reach for `@nexpress/oauth-providers` directly.

Once registered, providers may declare `audiences: ["staff"]`,
`["member"]`, or both. Staff login and member login render only
providers that support their audience; older custom providers without
an `audiences` declaration remain visible on both surfaces for
back-compat.

### 6.3 Staff auth pages — same model, different pool

`createStaffAuthRoutes()` is the parallel factory for the
admin (`/api/auth/*`) user pool — different table (`np_users`),
different cookie names (`np-session` / `np-refresh` /
`np-csrf`), no registration flow (staff are admin-provisioned),
no email verification (staff are auto-active), but with a
`changePassword` endpoint for the authenticated-user flow that
member's `/me` PATCH covers.

```ts
// apps/<app>/src/lib/auth-routes.ts
import { createStaffAuthRoutes } from "@nexpress/auth-pages/server";
import { getDb } from "@/lib/bootstrap";
import { ensureFor, nexpressConfig } from "@/lib/init-core";
import {
  clearAuthCookies,
  getAuthRuntimeConfig,
  optionalAuth,
  requireAuth,
  setAuthCookies,
} from "@/lib/auth-helpers";

export const staffAuthRoutes = createStaffAuthRoutes({
  getDb,
  ensureFor,
  authHelpers: {
    setAuthCookies,
    clearAuthCookies,
    getAuthRuntimeConfig,
    requireAuth,
    optionalAuth,
  },
  site: { name: nexpressConfig.site.name, url: process.env.SITE_URL ?? null },
});
```

```ts
// app/api/auth/login/route.ts
import { staffAuthRoutes } from "@/lib/auth-routes";
export const POST = staffAuthRoutes.login;
```

Nine handlers cover every flow: `login`, `logout`, `refresh`,
`forgotPassword`, `resetPassword`, `changePassword`,
`oauthStart`, `oauthCallback`, `meGet`. Behavior is byte-for-byte
identical to the framework's `@nexpress/app/api/auth/*` route
implementations — same lockout config (env-driven via
`NP_MAX_LOGIN_ATTEMPTS` / `NP_LOCKOUT_DURATION`), same OAuth
state cookies, same `auth:afterLogin` / `auth:beforeLogout`
plugin hooks, same `np-admin-site` cookie clear on logout.

Staff client forms (`/admin/login`, `/admin/forgot-password`,
`/admin/set-password`) still ship hand-coded fetch logic for
now — headless React hooks for the staff side are a separate
follow-up. The route factory is the higher-impact part (security
patches flow through the package version) and is shippable
independently.

---

## 7. Plugins

Themes / pages often want to behave differently when a plugin is
active (e.g. render comments only if the comments plugin is
installed). Three helpers cover the cases:

```ts
import { isPluginEnabled, getPluginRegistration, getPluginConfig } from "@nexpress/core";

if (await isPluginEnabled("@nexpress/plugin-reading-time")) {
  // Plugin is installed AND enabled.
}

// Manifest + metadata (name, version, hooks, routes…)
const reg = getPluginRegistration("@nexpress/plugin-reading-time");

// The operator-saved config, typed.
type ReadingTimeConfig = { wordsPerMinute?: number };
const config = await getPluginConfig<ReadingTimeConfig>("@nexpress/plugin-reading-time");
```

`getPluginConfig` returns three states you can distinguish:

- `null` → plugin not installed at all. Treat as "feature
  unavailable."
- `{}` → installed but the operator hasn't filled in any
  settings. Use plugin defaults.
- `{ wordsPerMinute: 220 }` → installed with saved config.

The generic parameter is unchecked at runtime. If the plugin
isn't yours, Zod-parse the result before trusting the shape.

> Don't call `runHook` from a theme/page. Hooks run during the
> content pipeline (`saveDocument` etc.); themes consume the
> output, not the lifecycle. Use `getPluginConfig` to _react_
> to plugin presence; let the plugin's own routes / blocks /
> render hooks contribute the actual rendering.

---

## 8. Member profiles

```ts
import { getMemberProfile } from "@nexpress/core/community";

// Accepts either id or handle in one argument.
const profile = await getMemberProfile(handle);
// → { id, handle, displayName, avatarUrl, bio, reputation, joinedAt } | null
```

Returns `null` when:

- no member matches the id / handle, or
- the member's status is `suspended` or `deleted` (treat as "not
  found" on public surfaces).

The avatar is resolved through `getMediaUrl` (defaults to the
`thumbnail` variant for profile-card sizes; pass `avatarVariant:
"original"` on the detail page itself):

```ts
const profile = await getMemberProfile(handle, { avatarVariant: "original" });
```

PII columns (`email`, `password`, `loginAttempts`, reset tokens,
notification prefs, plugin meta bag) are deliberately excluded —
this helper is safe to call from any public page without a
sensitivity audit.

### Listings — batch fetch

For a list view ("recent discussions by N members," "comment
thread with M authors"), looping `getMemberProfile` would fire
N queries. Use the batch form instead:

```ts
import { getMemberProfiles } from "@nexpress/core/community";

const authorIds = result.docs
  .map((d) => d.memberAuthorId as string | null)
  .filter((v): v is string => typeof v === "string" && v.length > 0);

// One SELECT for the rows, parallel `getMediaUrl` calls for avatars.
const authorById = await getMemberProfiles(authorIds);
// → Map<id, NpMemberProfile>

result.docs.map((doc) => {
  const author = doc.memberAuthorId
    ? authorById.get(doc.memberAuthorId as string)
    : null;
  return author ? <Link href={`/u/${author.handle}`}>@{author.handle}</Link> : null;
});
```

The map only contains entries for ids that matched (suspended /
deleted members are dropped) — so always check `if (author)`
before reading fields. Empty input returns an empty map without
hitting the DB.

### `joinedAt` is a `Date`, not a string

`NpMemberProfile.joinedAt` is a server-side `Date` instance.
Calling `.toLocaleDateString()` works inside an RSC. If you pass
the profile to a client component as a prop, Next serializes it
to an ISO string — call `.toISOString()` (or format) yourself
before crossing the boundary, or accept `string` on the client
side and parse with `new Date(...)`.

### Per-request dedup with React `cache()`

A typical page calls `getMemberProfile` twice — once in
`generateMetadata` for the title, once in the page export for
the body. Each call hits the DB independently. React's `cache()`
deduplicates by argument tuple, so wrap once at the app boundary:

```ts
// src/lib/cached-content.ts (a new file you author in your site —
// not a framework wrapper).
import { getMemberProfile } from "@nexpress/core/community";
import { cache } from "react";

export const getCachedMemberProfile: typeof getMemberProfile = cache(getMemberProfile);
```

Then both `generateMetadata` and the page import the wrapped
version:

```tsx
import { getCachedMemberProfile } from "@/lib/cached-content";

export async function generateMetadata({ params }) {
  const { handle } = await params;
  const profile = await getCachedMemberProfile(handle); // fetch
  // ...
}

export default async function ProfilePage({ params }) {
  const { handle } = await params;
  const profile = await getCachedMemberProfile(handle); // cached, no fetch
  // ...
}
```

Caveat: caching is keyed on the FULL argument tuple. A page that
passes `{ avatarVariant: "thumbnail" }` in metadata and
`{ avatarVariant: "original" }` in the body will issue two
fetches — that's correct (different sizes mean different
fetches). Pages that genuinely want one fetch should pass the
same options at both call sites, or rely on the default.

The same pattern works for any read primitive: `getMediaUrl`,
`getPluginConfig`, `getNavigation`, `findPosts`, the generated
`findDiscussions` etc. Wrap the ones your pages call twice;
leave the others alone.

---

## 9. Theme tokens

```ts
import { getCachedTheme } from "@nexpress/next";
import { getCachedActiveTheme } from "@/lib/cached-theme";
import { NpThemeStyle } from "@nexpress/theme";

const tokens = await getCachedTheme(); // resolved tokens (defaults + active theme + admin overrides)
const active = await getCachedActiveTheme(); // the registered theme object — has .impl with shell/slots
```

Themes inject their own CSS via `active?.impl.css`. The framework
ships the canonical `(site)` layout at `@nexpress/app/site/layout`
(re-exported from `apps/web/src/app/(site)/layout.tsx`) — copy its
shape into your scaffold if you're building a custom top-level
layout. See [`theme-authoring.md`](theme-authoring.md) for the
full `defineTheme` contract.

---

## 10. Block rendering

```ts
import { renderBlocks } from "@nexpress/blocks";
import { renderRichText } from "@nexpress/editor";
import { createDefaultBlockRenderContext } from "@nexpress/next";

const ctx = createDefaultBlockRenderContext();
const body = renderBlocks(page.body, { ctx }); // React tree, server-safe

// Lexical JSON → React tree for rich-text fields that aren't blocks.
const richBody = renderRichText(post.content);
```

Both functions are server-safe — never import the editor's
`/client` subpath from a `(site)` route. Block plugins extend
this rendering automatically; nothing to wire up here beyond
calling `ensureFor("plugins")` if your page expects plugin-
augmented blocks.

---

## 11. SEO

```ts
import {
  buildArticleJsonLd,
  buildWebSiteJsonLd,
  buildAtomFeed,
  buildSitemap,
} from "@nexpress/core/seo";
import { buildPageMetadata } from "@nexpress/next";
import type { Metadata } from "next";

export async function generateMetadata({ params }): Promise<Metadata> {
  await ensureFor("read");
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  const ogImage = await getMediaUrl(post.heroImageId, { variant: "og" });
  return buildPageMetadata({
    title: post.title,
    description: post.excerpt,
    path: `/blog/${post.slug}`,
    ogType: "article",
    publishedTime: post.publishedAt ? new Date(post.publishedAt) : null,
    ogImage,
  });
}
```

> **Two `buildPageMetadata`s, pick the right one.**
> `@nexpress/core` exports a framework-agnostic version returning
> `NpPageMetadata` (no `next` types in core). `@nexpress/next`
> re-exports a thin wrapper that returns `Promise<Metadata>` so
> `generateMetadata` accepts it without an `as Metadata` cast.
> Pages should always import from `@nexpress/next`. Server-side
> tools that don't depend on Next (e.g. a static-site exporter)
> can keep using the core form.

JSON-LD as a child component:

```tsx
import { JsonLd } from "@/components/json-ld";

const ld = await buildArticleJsonLd({
  url: `${siteUrl}/blog/${post.slug}`,
  headline: post.title,
  datePublished: post.publishedAt,
  authorName: post.author?.displayName,
});

return (
  <>
    <JsonLd data={ld} />
    <article>{/* … */}</article>
  </>
);
```

For sitemap and Atom feed entry points, every scaffold already
exposes `/sitemap.xml` and `/feed.xml` — the implementations live
in `@nexpress/app/root/{sitemap,feed}/route` and are re-exported
from `src/app/{sitemap,feed}.xml/route.ts` thin wrappers (same
shape in `apps/web`).

---

## 12. Pagination

`NpFindResult` already gives you everything: `page`, `totalPages`,
`hasPrevPage`, `hasNextPage`. The framework intentionally doesn't
ship a `<Pagination />` component because the visual treatment is
theme territory. There's a reference implementation at
`@nexpress/app/components/pagination-nav` (also visible as a thin
wrapper in `apps/web/src/components/pagination-nav.tsx`) you can
copy into your site as a starting point and restyle:

```tsx
import { PaginationNav } from "@/components/pagination-nav";

<PaginationNav
  page={pageNum}
  totalPages={result.totalPages}
  hasPrevPage={result.hasPrevPage}
  hasNextPage={result.hasNextPage}
  hrefForPage={(p) => `/discussions?page=${p}`}
/>;
```

The caller composes URLs (so extra search params like
`?author=me` survive untouched). The component renders nothing
when `totalPages <= 1` — no need to gate the include.

---

## 13. Anti-patterns

These will compile but break the build, leak admin code, or
quietly produce wrong output:

- **`import "@nexpress/core"` from a client component.** Pulls
  `pg`, `sharp`, `argon2` into the browser bundle. Use
  `import type` only on the client side. Server data fetching
  must happen in RSCs.
- **`import "@nexpress/admin"` from `(site)/*`.** Leaks the admin
  bundle to public pages.
- **`import "next/cache"` directly.** Use `revalidateCollection()`
  from `@nexpress/next` so the framework's cache tags stay
  consistent.
- **Creating a parallel DB connection** (`new Pool(...)` in your
  page). Use the singleton — call `ensureFor(...)` then read
  `getDb()`.
- **Calling `runHook` from a theme/page render.** Hooks belong
  in the write pipeline. Themes consume; they don't trigger.
- **Skipping `ensureFor`.** Reads will throw because `getDb()` is
  null until the bootstrap runs. Always call it as the first
  await in your RSC / route handler.
- **Trusting `getPluginConfig` shape without validation** when
  you don't own the plugin. The generic parameter is a hint, not
  a guarantee.

---

## 14. Feedback

If a recipe you needed isn't here, open an issue with the
"page-author" label describing what you were trying to do. The
shortest path to a new primitive is a concrete page that's awkward
to write today; abstract suggestions tend to produce surfaces no
one calls.

For surface that _is_ documented but feels rough, the same applies —
include the call site and the rough edge in the issue. The doc
isn't a contract; it's a pointer to the contract (`AGENTS.md`'s
**Stability** section), so DX issues here are fixable.

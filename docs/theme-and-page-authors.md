# Theme & custom-page author cookbook

This is the recipe book for two adjacent jobs:

- Authoring a **custom Next.js page** that lives under
  `apps/web/src/app/(site)/*` and ships as part of your site code
  (`/blog`, `/search`, `/u/[handle]`, …).
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
12. [What NOT to import from a theme / page](#12-anti-patterns)
13. [Where to ask for new helpers](#13-feedback)

---

## 1. Bootstrap

Every server route or RSC that touches `@nexpress/core` data must
call `ensureFor(intent)` first. Without it, `getDb()` throws
`"Database not initialized"` and the request 500s.

```ts
// apps/web/src/app/(site)/blog/page.tsx
import { ensureFor } from "@/lib/init-core";

export default async function BlogIndex() {
  await ensureFor("read");
  // ...now safe to call findDocuments / getMediaUrl / etc.
}
```

The three intents:

| Intent | Use when |
| --- | --- |
| `"read"` | Read-only RSC pages and `GET` API routes (most of this guide). |
| `"plugins"` | When render needs `runHook` to fire (block / site pages with plugin-augmented rendering). |
| `"write"` | Mutating routes / server actions / import scripts. |

Custom pages are almost always `"read"`. Use `"plugins"` if your
page renders blocks that plugins extend.

---

## 2. Reading content

| Symbol | Use for |
| --- | --- |
| `getPageBySlug(slug, { draft?, locale? })` | One CMS page document (`pages` collection). |
| `getPostBySlug(slug, { draft? })` | One post document (`posts` collection). |
| `getDocumentById(collection, id)` | Any document by id, any collection. |
| `findDocuments(collection, options)` | Listing with `where`, `sort`, `page`, `limit`, `locale`, `search`. |
| `findPosts(options)` | Sugar over `findDocuments("posts", options)`. |
| `getAllPageSlugs()` | Static path generation. |
| `findSlugRedirect(oldSlug)` | Resolve a historic slug → `{ slug, status }`. |
| `searchCollections({ query, limit, ... })` | Full-text search across registered collections. |

> `getPageBySlug` / `getPostBySlug` / `findPosts` /
> `getAllPageSlugs` are convenience helpers hardcoded to the
> `pages` and `posts` collections. For your own collection, call
> `findDocuments("yourCollection", options)` and
> `getDocumentById("yourCollection", id)` directly.

All from `@nexpress/core`.

```ts
// app/(site)/blog/page.tsx
import { findPosts, getCurrentLocale } from "@nexpress/core";
import { ensureFor } from "@/lib/init-core";

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

---

## 3. Media & images

```ts
import { getMediaById, getMediaUrl } from "@nexpress/core";

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
the lookup walks `media.sizes` regardless. Returns `null` for
unknown / soft-deleted ids.

If you also need the dimensions, alt text, or filename, fetch the
record first:

```ts
const media = await getMediaById(post.heroImageId);
if (media) {
  const url = await getMediaUrl(media.id, { variant: "large" });
  return <img src={url ?? ""} alt={media.alt ?? ""} width={media.width} height={media.height} />;
}
```

---

## 4. Settings & navigation

```ts
import { getSetting, getNavigation } from "@nexpress/core";

// Site identity
const site = await getSetting<{ name: string; url: string }>("site");
const description = await getSetting<string>("description");

// Navigation menus by location slug
const header = await getNavigation("header"); // returns NpNavItem[] tree
const footer = await getNavigation("footer");
```

`getSetting` is generic — pass the expected shape as the type
parameter. The framework doesn't validate; you should wrap with a
Zod parse if the shape is plugin-controlled.

`getNavigation` returns the saved tree (with `children: NpNavItem[]`
for nested items). Items have `type: "link" | "page" | "collection"` —
render accordingly. The location slug is whatever the operator
created in **Settings → Navigation**. Built-ins: `"header"`,
`"footer"`, `"main"`.

The navigation editor's **link** type can autocomplete from the
custom-routes registry — make sure your hand-coded routes are
registered (see [§4.1](#4-1-register-your-hand-coded-routes)) so
operators can pick them from a dropdown.

### 4.1 Register your hand-coded routes

```ts
// apps/web/src/lib/custom-routes.ts
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

Call `registerCustomRoutes()` once at boot (the reference app
hooks this into `ensureFor("read")` in `apps/web/src/lib/init-core.ts`).
The routes show up in **Settings → Routes** for operators and as
autocomplete in the navigation editor's link picker.

---

## 5. i18n & localization

```ts
import { resolveLocale, getCurrentLocale, t, tSync } from "@nexpress/core/i18n";

// Inside an RSC, headers() gives you both signals
import { headers } from "next/headers";

const headerList = await headers();
const pathname = headerList.get("x-np-pathname") ?? "/"; // stamped by `apps/web/src/proxy.ts`
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

| Helper | Returns | When |
| --- | --- | --- |
| `requireAuth(request)` | `NpAuthUser` (throws on absence) | Staff-gated **API routes** (need a `NextRequest`). From the per-app `createAuthHelpers()` output. |
| `optionalAuth(request)` | `NpAuthUser \| null` | API routes that render differently for staff but don't require it. |
| `getSiteMember()` | `NpMemberAuthRow \| null` | RSC pages that show member-only content. App-level helper around `optionalMember(request)`. |

API routes get the request directly:

```ts
// app/api/posts/draft/route.ts
import { can, NpForbiddenError } from "@nexpress/core";
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
import { can, NpForbiddenError } from "@nexpress/core";
const user = await requireAuth(request);
if (!can(user, "admin.manage")) throw new NpForbiddenError("settings", "view");
```

Capability strings are stable in v0.1 — see `AGENTS.md`'s
**Stability** section.

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
> output, not the lifecycle. Use `getPluginConfig` to *react*
> to plugin presence; let the plugin's own routes / blocks /
> render hooks contribute the actual rendering.

---

## 8. Member profiles

```ts
import { getMemberProfile } from "@nexpress/core";

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
import { getMemberProfiles } from "@nexpress/core";

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

---

## 9. Theme tokens

```ts
import { getCachedTheme } from "@nexpress/next";
import { getCachedActiveTheme } from "@/lib/cached-theme";
import { NpThemeStyle } from "@nexpress/theme";

const tokens = await getCachedTheme(); // resolved tokens (defaults + active theme + admin overrides)
const active = await getCachedActiveTheme(); // the registered theme object — has .impl with shell/slots
```

Themes inject their own CSS via `active?.impl.css`. The reference
site layout (`apps/web/src/app/(site)/layout.tsx`) is the
canonical example — copy its shape if you're building a custom
top-level layout. See [`theme-authoring.md`](theme-authoring.md)
for the full `defineTheme` contract.

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
} from "@nexpress/core";
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

For sitemap and Atom feed entry points, the reference app already
exposes `/sitemap.xml` and `/feed.xml` — see
`apps/web/src/app/sitemap.xml/route.ts` and
`apps/web/src/app/feed.xml/route.ts` for the wiring.

---

## 12. Anti-patterns

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

## 13. Feedback

If a recipe you needed isn't here, open an issue with the
"page-author" label describing what you were trying to do. The
shortest path to a new primitive is a concrete page that's awkward
to write today; abstract suggestions tend to produce surfaces no
one calls.

For surface that *is* documented but feels rough, the same applies —
include the call site and the rough edge in the issue. The doc
isn't a contract; it's a pointer to the contract (`AGENTS.md`'s
**Stability** section), so DX issues here are fixable.

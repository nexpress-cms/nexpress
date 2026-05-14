# Theme Authoring Guide

> Phase 11 ships NexPress's theming system. This guide covers
> the contract for shipping a theme package, what each piece
> does at runtime, and how a developer goes from a fresh
> `pnpm create nexpress` install to a working custom theme.

---

## Table of Contents

1. [What a Theme Is](#1-what-a-theme-is)
2. [Anatomy of a Theme Package](#2-anatomy-of-a-theme-package)
3. [The `defineTheme` Contract](#3-the-definetheme-contract)
4. [Shell, Slots, Templates](#4-shell-slots-templates)
5. [Theme-owned CSS](#5-theme-owned-css)
6. [Per-collection Page Templates](#6-per-collection-page-templates)
7. [Dark Mode](#7-dark-mode)
8. [Tokens vs Theme Code](#8-tokens-vs-theme-code)
9. [Registering and Activating](#9-registering-and-activating)
10. [Server vs Client Boundary](#10-server-vs-client-boundary)
11. [Reference Theme Examples](#11-reference-theme-examples)
12. [Plugins Can Register Templates Too](#12-plugins-can-register-templates-too)

---

## 1. What a Theme Is

A NexPress theme is an npm package that exports a `defineTheme(...)`
result. It controls the **structure** of the rendered site:

- The outer `<Shell>` wrapping every public page
- The `header` / `footer` / `nav` / `sidebar` slots
- Per-collection page templates (e.g. `pages.default`, `pages.wide`)
- Theme-owned CSS injected into the `<head>` when the theme is active

It does **not** control:

- The content data (collections live in `nexpress.config.ts`)
- The block library (provided by `@nexpress/blocks` + plugins)
- User-customizable design tokens (those live in the admin
  Settings → Theme tab and override the theme's own defaults)

In WordPress terms: themes are like "themes", tokens are like
"customizer settings", and blocks are the editor primitives.

---

## 2. Anatomy of a Theme Package

A minimal theme package looks like:

```
packages/themes/mybrand/
├── package.json
├── tsup.config.ts
├── tsconfig.json
└── src/
    ├── index.ts        # defineTheme(...)
    ├── shell.tsx       # outer wrapper
    ├── header.tsx      # header slot
    ├── footer.tsx      # footer slot
    ├── styles.ts       # CSS string
    └── templates/
        ├── page-default.tsx
        └── page-wide.tsx
```

`package.json` essentials:

```json
{
  "name": "@yourco/theme-mybrand",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "peerDependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "dependencies": {
    "@nexpress/blocks": "workspace:*",
    "@nexpress/core": "workspace:*",
    "@nexpress/theme": "workspace:*"
  }
}
```

The `tsup.config.ts` ships ESM output. If your theme has a
client component (e.g. an interactive nav drawer using
`useState`), build it as a **separate entry** with a
`"use client"` banner — see the [server/client boundary](#9-server-vs-client-boundary)
section.

---

## 3. The `defineTheme` Contract

`defineTheme()` is an identity function: it accepts an
`NpTheme` and returns it. Its job is to give TypeScript the
hook to infer the full shape so editor IntelliSense works.

```ts
// src/index.ts
import { defineTheme } from "@nexpress/theme";

import { Shell } from "./shell.js";
import { Header } from "./header.js";
import { Footer } from "./footer.js";
import { mybrandCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";

export const mybrandTheme = defineTheme({
  manifest: {
    id: "mybrand",                 // unique key used in np_settings.activeTheme
    name: "MyBrand",
    version: "0.1.0",
    description: "Editorial mybrand theme",
    author: { name: "MyBrand", url: "https://example.com" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: Shell,
    slots: {
      header: Header,
      footer: Footer,
    },
    css: mybrandCss,
    templates: {
      pages: {
        default: {
          label: "Default",
          description: "Centered article column.",
          component: PageDefaultTemplate,
        },
      },
    },
  },
});
```

The `manifest` is pure metadata (used by the admin theme
switcher). The `impl` carries React component refs, the CSS
string, and per-collection templates.

---

## 4. Shell, Slots, Templates

### Shell

Wraps the entire `(site)` route group on every render. Receives
`children` (which is the slot stack: header → main → footer).
Use a Shell to do site-wide things like a sticky banner, a
provider tree, or a CSS class on `<body>`-equivalent.

```tsx
// src/shell.tsx
import type { NpThemeShellProps } from "@nexpress/theme";

export function Shell({ children }: NpThemeShellProps) {
  return <div className="np-mybrand-shell">{children}</div>;
}
```

If you omit `shell`, the framework renders `children` as a
fragment with no wrapping element.

### Slots

`header`, `footer`, `nav`, `sidebar`, `beforeContent`,
`afterContent`. Each is an optional `ComponentType`. Every theme
will use `header` and `footer`; the others are opt-in.

Slot components are server components by default — they can be
async, read from collections, and call `getNavigation()` from
core directly.

If you want an interactive piece in your header (a search box, a
member status widget), put it in a separate file with `"use client"`
at the top and import it from your server header. See the
[server/client boundary](#9-server-vs-client-boundary) section.

### Templates

Per-collection page renderers, keyed by collection slug then
template id. Pages choose their template via a `template` field
(see [section 6](#6-per-collection-page-templates)).

---

## 5. Theme-owned CSS

A theme ships its layout CSS as a string in `impl.css`. The
framework injects it at SSR time as:

```html
<style data-np-theme="mybrand">/* your CSS */</style>
```

Why a string and not a stylesheet?

- **No round trip** — bytes race with the document, no FOUC.
- **Active-only** — only the active theme's CSS is rendered.
  Switching themes doesn't leave dead rules behind.
- **`data-np-theme` attribute** — DevTools makes the source
  obvious; selectors can scope by `[data-np-theme="mybrand"]`
  if a parent adopts the attribute.

Put **layout-specific** rules here:

- `.np-site-header`, `.np-site-footer` overrides for your shell
- Theme-specific class names (`.np-mybrand-*`)
- Page-template modifiers like `.np-page-wide`

**Don't** put cross-theme primitives here (forms, member auth,
discussion threads). Those live in the consuming app's
`globals.css` because every theme renders them identically.

Token references are written as `var(--np-color-primary)`. The
admin's Settings → Theme tab generates `:root { --np-* }`
declarations from the saved tokens, so your CSS automatically
reflects user customizations without the theme touching tokens.

---

## 6. Per-collection Page Templates

Templates let a collection's documents pick a render variant.
The default theme ships `pages.default` (centered) and `pages.wide`
(edge-to-edge); your theme can ship any number for any collection.

Each template is `{ label, description?, component }`:

```tsx
templates: {
  pages: {
    default: { label: "Default", component: PageDefaultTemplate },
    wide:    { label: "Wide",    description: "Edge-to-edge", component: PageWideTemplate },
    landing: { label: "Landing", component: LandingTemplate },
  },
  posts: {
    article: { label: "Article",   component: ArticleTemplate },
    photo:   { label: "Photo lead", component: PhotoLeadTemplate },
  },
}
```

The component receives `{ doc }` typed as `Record<string, unknown>`
by default. Cast in the body to your collection's shape (or pass
a generic to `NpTemplateRenderProps<MyDocShape>`).

Pages opt into the picker by adding a `template` field with
`admin.kind: "templatePicker"`:

```ts
{
  type: "text",
  name: "template",
  admin: { kind: "templatePicker" },
}
```

The admin form replaces the plain text input with a `<Select>`
fetched from `/api/admin/themes/active/templates?collection=…`,
so the dropdown stays in sync with whichever theme is active.

---

## 7. Color Scheme (Light / Dark)

Color-mode handling is opt-in per theme. The framework no
longer prescribes a dark-mode shape on `NpThemeTokens`, no
longer auto-emits a `[data-theme="dark"]` block, and no
longer mounts a global init script — every theme picks its
own policy (saved choice, time-of-day, seasonal palette,
none at all) and ships the matching CSS.

The theme system exposes three small primitives so themes
that *do* want a saved-choice toggle don't have to reinvent
the wheel:

| Export                        | From                       | Purpose                                                   |
| ----------------------------- | -------------------------- | --------------------------------------------------------- |
| `<NpColorSchemeScript />`     | `@nexpress/theme`          | Inline pre-paint script that flips `<html data-theme>` based on cookie / localStorage / `prefers-color-scheme`. |
| `COLOR_SCHEME_COOKIE` / `COLOR_SCHEME_STORAGE_KEY` | `@nexpress/theme/client` | Shared key names so the toggle, server reads, and script all agree. |
| `isColorScheme` / `NpColorScheme` | `@nexpress/theme/client` | Type guard + union for `"dark" \| "light"`.            |

A typical opt-in shell looks like this:

```tsx
// theme/src/shell.tsx
import { NpColorSchemeScript } from "@nexpress/theme";

export function MyShell({ children }: NpThemeShellProps) {
  return (
    <>
      <NpColorSchemeScript />
      {children}
    </>
  );
}
```

```css
/* theme/src/styles.ts */
[data-theme="dark"] {
  --np-color-background: oklch(0.145 0.004 285.823);
  --np-color-foreground: oklch(0.985 0.001 106.423);
  /* … flip whichever tokens this theme cares about … */
}
```

`@nexpress/theme-default` bundles the script in its shell, a
dark variant of the design tokens in its CSS, and a
`<DarkModeToggle />` in its header slot — copy that pattern
when you want the same UX. A theme that omits all three is
permanently in light mode (or whatever palette the tokens
declare); the framework adds nothing.

Because `<html>` ends up with a `data-theme` attribute that
the server didn't render, React would normally log a
hydration warning. The reference root layout sets
`<html suppressHydrationWarning>` as a generic escape hatch
for *any* theme that mutates `<html>` attributes pre-hydration
— it covers the color-scheme script case without the
framework knowing about the policy specifically. The flag
only silences the attribute diff on `<html>` itself; the rest
of the tree still surfaces hydration mismatches normally.

---

## 8. Tokens vs Theme Code

These are orthogonal axes:

| Axis      | Lives in                                    | Who edits     | Persists across theme swap?       |
| --------- | ------------------------------------------- | ------------- | --------------------------------- |
| Theme     | npm package's `impl`                        | Developer     | (the package controls structure)  |
| Tokens    | `np_settings.theme` row                     | Admin         | Yes — colors stay across themes   |

A theme can declare its own preferred token defaults via
`impl.tokens`, but the saved admin tokens always win. This is
intentional: brand color decisions made in the admin shouldn't
revert when an admin tries a different theme.

---

## 9. Registering and Activating

**Install (operator side, one command)**: from the project root, run

```bash
pnpm nexpress theme add @yourco/theme-mybrand
pnpm db:generate && pnpm db:migrate
```

`theme add` runs `pnpm add <pkg>`, then patches `nexpress.config.ts`
via the marker comments (`@nexpress:themes-imports-*` and
`@nexpress:themes-list-*`) to insert the import and append the
identifier to the `themes:` array. `defineConfig` then auto-merges
the theme's `manifest.requires.collections` into the resolved
`collections` array, so the operator's `src/collections/*.ts`
files stay untouched — `pnpm db:generate` picks up the new
columns from the merged config. `pnpm nexpress theme add --apply`
chains the two `db:*` commands in one go.

The marker comments are present in every freshly scaffolded
`nexpress.config.ts`. If a project's config doesn't have them
yet, `theme add` prints a copy-paste snippet and exits without
mutating anything; add the markers and re-run.

**Install (manual / explicit form)**: scaffolded sites can list
themes by hand if they prefer. The built-in pack
(`@nexpress/theme-default`, `theme-magazine`, `theme-portfolio`,
`theme-docs`) is exported as `defaultThemes` from
`@nexpress/app/config-defaults` — spread it and append your own:

```ts
import { defaultThemes } from "@nexpress/app/config-defaults";
import { mybrandTheme } from "@yourco/theme-mybrand";

export default defineConfig({
  // ...
  themes: [...defaultThemes, mybrandTheme],
});
```

If you don't want every built-in pack, drop `defaultThemes` and list
just the themes you ship:

```ts
import { magazineTheme } from "@nexpress/theme-magazine";
import { mybrandTheme } from "@yourco/theme-mybrand";

export default defineConfig({
  themes: [magazineTheme, mybrandTheme],
});
```

This is a build-time operation — adding or removing themes
requires a redeploy because the React components have to be
in the bundle.

**Activate**: at runtime, an admin opens Settings → Theme and
clicks "Activate" on the desired theme. That writes the id to
`np_settings.activeTheme` and busts the layout cache via
`revalidatePath("/", "layout")`. The next request renders the
new shell + CSS.

When no `activeTheme` is persisted (fresh install), the
framework falls back to the first theme in the registry. When
the persisted id no longer resolves (developer removed the theme
between deploys), the resolver also falls back to first-registered
rather than 500.

### Bundled-themes prebake — runtime swap without migration

Built-in themes (`@nexpress/theme-default`, `theme-magazine`,
`theme-portfolio`, `theme-docs`) ship together as `defaultThemes`,
and a freshly scaffolded `nexpress.config.ts` spreads the whole
pack into `themes:`. Because `defineConfig` runs
`mergeThemeRequirements` over EVERY entry in that array, every
built-in's `requires.collections` lands in the merged schema at
boot — not just the one that's currently active. After the first
`pnpm db:generate && pnpm db:migrate`, every column any built-in
theme needs is already in the database.

The payoff: switching the active theme from `/admin/appearance`
is just a `np_settings.activeTheme` flip. No restart, no
migration, no second `theme add`. Editors can try Magazine on
Monday and Docs on Friday with no operator involvement.

Two safety nets keep this honest:

- A CI gate (`apps/web/tests/builtin-themes-union.unit.test.ts`)
  asserts the union of every built-in's `requires` is
  conflict-free. If a future built-in declares the same field
  name as another with a different shape, the gate fails before
  the conflict reaches `main`.
- Theme-synthesised collections (those that exist only because
  a theme's `requires.collections.<slug>.createIfAbsent: true`
  asked for them) carry a `_themeOrigin` tag in the merged
  config. The admin sidebar hides them when the owning theme
  isn't active — so a docs-only site doesn't see Magazine's
  `authors` collection cluttering the nav even though the
  table exists in the DB. Field-level visibility (e.g. hiding
  Magazine's `posts.featured` field when running docs) is NOT
  filtered today; the column stays on the edit view so any data
  the operator captured under another theme remains addressable.

**This prebake applies only to the bundled built-ins.**
Third-party themes go through the regular `pnpm nexpress theme
add` flow — that's a code change (the config file is patched)
and a schema change (the next migration adds the columns), so it
needs a redeploy + migration. After the third-party theme is
added once, activating / deactivating it from admin is free
(same `np_settings.activeTheme` flip), but the install itself
is a build-time event.

If you intentionally pruned built-ins from `defaultThemes`
(e.g. `themes: [magazineTheme, mybrandTheme]`), the prebake
covers only what you spread in. Re-adding a built-in later
means running `pnpm db:generate && pnpm db:migrate` again to
pick up its columns. There is no `prebake-themes` upgrade
helper — the operator's `themes:` array is the source of truth
for what's in the union.

### First-boot demo content (`impl.seedContent`)

The setup wizard's "Add sample content" toggle runs the framework's
seeder via `seedAll(actor, theme)`. When the active theme declares
`impl.seedContent`, each slot drives the matching seeder; unset
slots fall through to the framework's generic content (the
"Welcome to NexPress" pages + framework-themed posts). This is
how built-in themes ship demo content that matches their visual
language without forking the seeder.

```ts
export const magazineTheme = defineTheme({
  manifest: { id: "magazine", /* … */ },
  impl: {
    /* shell, slots, templates, tokens, css, … */
    seedContent: {
      tags: [
        { name: "Politics", description: "…" },
        { name: "Culture", description: "…" },
      ],
      pages: [
        {
          title: "About the magazine",
          seoDescription: "…",
          blocks: [/* NpBlockInstance[] */],
        },
      ],
      posts: [
        {
          title: "The lead piece",
          excerpt: "…",
          content: lexicalDoc([/* … */]),
          publishedAt: "2026-05-01T00:00:00.000Z",
          tagNames: ["Politics"],
        },
      ],
      navigation: {
        header: [{ id: "h1", label: "Politics", type: "link", url: "/category/politics" }],
        footer: [{ id: "f1", label: "Masthead", type: "link", url: "/masthead" }],
      },
    },
  },
});
```

Slot-by-slot rules:

- **`tags` / `categories`** — `{ name, description? }`. Seeded
  before posts so post `tagNames` resolve to real ids. Names
  that don't resolve are skipped silently.
- **`pages`** — `{ title, slug?, seoDescription?, blocks }`.
  `slug` overrides the pipeline's title-derived slug (used for
  `/` on the home page). `blocks` is `NpBlockInstance[]` kept
  as `unknown[]` in the type so the JSON shape doesn't cross
  the package boundary; the seeder treats it opaquely.
- **`posts`** — `{ title, excerpt, content, publishedAt, status?,
  tagNames? }`. Lexical `content` is opaque to the type for the
  same reason. Past `publishedAt` = published; future = scheduled
  (the scheduled-publish cron promotes when the timestamp passes).
- **`navigation.header` / `navigation.footer`** — `NpNavItem[]`.
  Each entry needs a stable `id`; the framework doesn't generate
  ids for theme-seeded nav items, so author them as part of the
  static data (e.g. `id: "nav-magazine-politics"`).
- **`documents`** — keyed by collection slug for everything
  beyond pages/posts. Each entry is `{ slug, title, status?,
  publishedAt?, data? }`; `data` holds the collection-specific
  fields. Use this for `authors`, `glossary`, `projects`, or any
  user-declared collection a theme wants to ship demo data for.
  Idempotent per collection (skipped when the collection has any
  row). Unknown collection slugs are logged at warn level and
  reported in the result rather than aborting the wizard, so a
  theme that ships seed for an inactive collection degrades
  cleanly. The seeder injects `author: actor.id` automatically
  for collections that declare an `author` field — themes don't
  have to special-case the operator's user id.

```ts
seedContent: {
  documents: {
    authors: [
      {
        slug: "ada-lovelace",
        title: "Ada Lovelace",
        data: { bio: "First programmer." },
      },
    ],
    glossary: [
      {
        slug: "lexical",
        title: "Lexical",
        data: { definition: "The rich-text editor framework." },
      },
    ],
  },
}
```

**Asset references**: image URLs in block props (`hero.
backgroundImage`, `logosCloud.items[].src`, etc.) are baked into
the seeded page exactly as authored. Reference URLs that won't
go away — your own CDN, a stable third-party host. The seed
pages outlive the install, so a 404'd asset URL ships forever.

**Idempotency**: each seeder skips when the corresponding
collection / nav location already has at least one row. Re-running
seed-all on a populated install is a no-op. This is the same
behavior as the framework default content; theme-provided
`seedContent` doesn't change it.

**No `saveDocument` from a theme**: themes declare WHAT to seed,
not HOW. Calling `saveDocument` directly from a theme would
bypass the framework's pipeline (access control, hooks,
validation, search-vector build) and is not supported. The
seeder owns the write path.

Pre-1.0 stability note: `NpThemeSeedContent` and its sub-types
(`NpThemeSeedTerm`, `NpThemeSeedPage`, `NpThemeSeedPost`,
`NpThemeSeedNavigation`, `NpThemeSeedDocument`) are on the v0.1
stable surface. Adding optional fields to any of them is non-
breaking; renaming or removing one rides a minor + migration note.

---

## 10. Server vs Client Boundary

`@nexpress/theme-default` is the canonical example of how to ship
a theme that has both server-rendered slots and an interactive
piece (the member status widget).

The trick: a **two-entry `tsup` config**. The server entry bundles
everything except the client component, with the client component
file marked `external` so the import survives across the bundle
split. The client entry builds just the client component with a
`"use client"` banner.

```ts
// tsup.config.ts
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    external: [
      "react", "react-dom", "next", "next/link", "next/navigation",
      "@nexpress/blocks", "@nexpress/theme",
      "./components/member-status-widget.js",
    ],
  },
  {
    entry: { "components/member-status-widget": "src/components/member-status-widget.tsx" },
    format: ["esm"],
    dts: true,
    clean: false,
    external: ["react", "react-dom", "next", "next/link", "next/navigation"],
    banner: { js: '"use client";' },
  },
]);
```

If your theme is server-only (no `useState` / `useEffect` / event
handlers), you can use a single tsup entry — just keep `react`
and `next` external.

**Never import `@nexpress/core` from a client component.** Core
pulls in `pg`, `sharp`, and `argon2`; bundling them into a client
chunk breaks the build. If a client widget needs server data,
fetch it via an API route.

---

## 11. Reference Theme Examples

| Package                       | Role in repo                                       | v0.2 surfaces |
| ----------------------------- | -------------------------------------------------- | ------------- |
| `@nexpress/theme-magazine`    | Editorial / blog layout, hero + archives + patterns. | F.1–F.7 + M.* (every surface) |
| `@nexpress/theme-docs`        | Hierarchical docs with sidebar + search route.       | F.1–F.3, F.6, F.7 (no patterns / archives) |
| `@nexpress/theme-portfolio`   | Image-led dark theme, deep settings (12 fields).     | F.1, F.3, F.4, F.6, F.7 |
| `@nexpress/theme-default`     | v0.1-era baseline. Pre-v0.2 surfaces only — kept as the framework fallback when no other theme is configured. | v0.1 only |

For new themes, copy from `theme-magazine` / `theme-docs` /
`theme-portfolio` — they exercise the v0.2 surfaces (manifest
requires, settingsSchema, blocks, patterns, navLocations,
archives, routes, seo). `theme-default` is kept as a working
`defineTheme` reference for the v0.1 baseline shape but doesn't
declare v0.2 surfaces; copying from it gets you a basic shell +
header + footer without the operator-no-code surfaces.

`@nexpress/theme-minimal` (a 99-LOC v0.1 demo proving the
slot system) was retired in #590 once F-track + M-track merged
the slot-system story into reference theme adoption. Sites that
were on minimal should switch to `theme-default` (same v0.1
contract, more production-grade) or move up to a v0.2 reference
theme.

The contract is the same regardless of which template you
copy from; the only constraint is that your theme's
`manifest.id` must be unique within the registry.

### v0.2 surfaces cheat-sheet

For full design rationale + deferred items per surface see
[`docs/design/theme-v0.2-extension.md`](./design/theme-v0.2-extension.md)
(frozen snapshot). The reference themes
(`packages/themes/{magazine,docs,portfolio}`) are the live
implementation reference.

| Surface | What it does |
|---|---|
| `manifest.requires` | Declare collection field expectations; the framework auto-merges them into the operator's `collections` array at `defineConfig` time. Operators run `pnpm nexpress theme add <pkg>` to install + register, then `pnpm db:generate && pnpm db:migrate` to materialise the columns. Admin warns at activation time only when an operator-declared field has a conflicting TYPE. |
| `manifest.settingsSchema` | Zod schema → admin auto-form. Operator tunes per site without editing code. Reuses `nx:theme:<siteId>` cache tag. |
| `impl.blocks` | Theme-shipped block types. Bootstrap auto-stamps `source: "theme:<id>"` for active-source filtering in multi-site processes. |
| `impl.patterns` | Pre-shaped block subtrees the page-builder drops in one click (Cmd-K → Pattern). |
| `impl.navLocations` | Declare nav mount points with labels; admin nav editor populates its location dropdown from the active theme's declarations. |
| `impl.routes` / `impl.archives` | Declared dynamic routes (`/category/:slug`, `/search`, `/lookbook`). Catch-all dispatches with precedence: app-explicit > page-slug > theme route. |
| `impl.notFound` / `impl.seo` | 404 page + sitemap/feed/robots contributions. Theme switch + settings save bust SEO cache tags appropriately. |

### Member surface (M.*) cheat-sheet

For full design rationale see [`docs/design/member-surface-skinning.md`](./design/member-surface-skinning.md). The magazine reference (`packages/themes/magazine`) is the live implementation reference for every M.* surface listed below.

| Surface | What it does |
|---|---|
| `impl.members.shell` | Wraps the framework-owned `(member)/members/*` route tree (login / register / forgot-password / reset-password / verify / me/notifications) in the theme's chrome. Receives an opaque `children` prop — themes don't depend on the framework body internals. Falls back through `impl.shell` to a transparent fragment when omitted (M.1). |
| `impl.members.pageTitle?.{login,register,…}` | Theme-provided variants of the framework's default member-page chrome strings. Operator i18n bundles override on top via the existing UI-string registry. Optional cosmetic (M.1). |
| `--np-member-form-*` tokens | CSS custom properties on the form input / button / error surface (`.np-members-form` scope). Themes restyle member auth forms by overriding these tokens in `impl.css` rather than replacing components (M.2). |
| `--np-member-oauth-{google,github}-*` | Forward-compat tokens for the OAuth button surface (no consumer renders today; `/api/members/oauth/{provider}/start` runs the flow directly). Declared so themes can pre-style for when buttons land (M.2). |
| `impl.members.notFound` | Member-tree 404 component. Server-rendered. Falls back to `impl.notFound` (top-level), then to a member-tuned framework default (`/members/login` CTA — most 404s inside `/members/*` are stale auth links) (M.3). |
| `impl.members.error` + `./components/members-error` subpath | Forward-compat type marker on the manifest; the actual render lives at a separate client subpath the theme ships at `./components/members-error`. The operator's `(member)/error.tsx` lazy-imports the active theme's chunk based on the `<style data-np-theme>` tag the layout already emitted. F.7.1 delegation pattern (Next mandates `error.tsx` is `"use client"`) (M.3). |

### Member surface migration recipe

The shortest end-to-end migration is `theme-magazine` (M.ref). Recipe in five files:

1. **`src/members-shell.tsx`** — server component, wraps `children` in your masthead + footer. Use a `<div>` (not `<main>`) — the framework layout already emits the page's single `<main>` landmark.
2. **`src/members-not-found.tsx`** — server component for the member-tree 404. Tone the copy for stale-auth-link cases; CTA points to `/members/login`.
3. **`src/components/members-error.tsx`** — `"use client"` component for the error boundary. Same delegation pattern as `./components/error`. Add `"Back to sign in"` alongside `"Try again"`.
4. **`src/styles.ts`** (or your theme CSS) — override `--np-member-form-*` tokens scoped under `.<your-theme-root> .np-members-form`. Discussion / comment forms keep their global look; member forms pick up your theme's edge.
5. **`src/index.ts`** — declare `impl.members.{shell, notFound}`.

Then **register your theme in `apps/web/src/app/(member)/error.tsx`'s `THEME_MEMBER_ERRORS`** map (`<your-theme-id>: lazy(() => import("@nexpress/theme-<id>/components/members-error"))`), and **add the subpath to `package.json` exports + `tsup.config.ts`**.

When omitted, the fallback chain ensures the public-site shell + 404 + error apply — themes that don't migrate keep working unchanged.

---

## 12. Plugins Can Register Templates Too

Phase 14.5 — plugins use the same template shape as themes
and merge into the same registry. A plugin manifest may
declare:

```ts
definePlugin({
  manifest: { id: "docs", name: "Documentation", ... },
  templates: {
    pages: {
      docs: {
        label: "Documentation",
        description: "Sidebar TOC + prev/next navigation",
        component: DocsTemplate,
      },
    },
  },
});
```

The plugin host registers these at boot.
`getThemeTemplateSummaries(collectionSlug)` returns the
union of theme + plugin templates so the admin
template-picker dropdown sees both. The catch-all's
`resolveTemplateComponent` walks **theme first**, then
plugins — so on id collision the active theme wins. This is
deliberate: the active theme is the site's design authority,
and plugin templates are baselines / domain-specific
alternates.

When a plugin's template id is unique (recommended:
namespace it like `docs.sidebar` or `events.calendar`), it
sits alongside theme templates in the picker without ever
colliding. Plugin authors who want their template to be
overridable by sites just register it with a generic id;
the site's chosen theme can ship its own version of that id
and seamlessly take over.

Use cases:
- A `docs` plugin shipping a `pages.docs` template (TOC + version selector)
- An `events` plugin shipping `pages.event` (calendar embed + RSVP)
- A `commerce` plugin shipping `pages.product` (price + cart widget)
- A `course` plugin shipping `posts.lesson` (progress bar + prev/next)

Plugins can also use the existing slot system
(`beforeContent`, `afterContent`, `sidebar`) when they want
to inject UI without owning the entire page render. The two
mechanisms are orthogonal: a plugin can both ship a template
and contribute slot components.

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
7. [Tokens vs Theme Code](#7-tokens-vs-theme-code)
8. [Registering and Activating](#8-registering-and-activating)
9. [Server vs Client Boundary](#9-server-vs-client-boundary)
10. [Reference Theme Examples](#10-reference-theme-examples)

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
packages/theme-mybrand/
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
    "next": "^15.0.0",
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
`NxTheme` and returns it. Its job is to give TypeScript the
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
    id: "mybrand",                 // unique key used in nx_settings.activeTheme
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
import type { NxThemeShellProps } from "@nexpress/theme";

export function Shell({ children }: NxThemeShellProps) {
  return <div className="nx-mybrand-shell">{children}</div>;
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
<style data-nx-theme="mybrand">/* your CSS */</style>
```

Why a string and not a stylesheet?

- **No round trip** — bytes race with the document, no FOUC.
- **Active-only** — only the active theme's CSS is rendered.
  Switching themes doesn't leave dead rules behind.
- **`data-nx-theme` attribute** — DevTools makes the source
  obvious; selectors can scope by `[data-nx-theme="mybrand"]`
  if a parent adopts the attribute.

Put **layout-specific** rules here:

- `.nx-site-header`, `.nx-site-footer` overrides for your shell
- Theme-specific class names (`.nx-mybrand-*`)
- Page-template modifiers like `.nx-page-wide`

**Don't** put cross-theme primitives here (forms, member auth,
discussion threads). Those live in the consuming app's
`globals.css` because every theme renders them identically.

Token references are written as `var(--nx-color-primary)`. The
admin's Settings → Theme tab generates `:root { --nx-* }`
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
a generic to `NxTemplateRenderProps<MyDocShape>`).

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

## 7. Tokens vs Theme Code

These are orthogonal axes:

| Axis      | Lives in                                    | Who edits     | Persists across theme swap?       |
| --------- | ------------------------------------------- | ------------- | --------------------------------- |
| Theme     | npm package's `impl`                        | Developer     | (the package controls structure)  |
| Tokens    | `nx_settings.theme` row                     | Admin         | Yes — colors stay across themes   |

A theme can declare its own preferred token defaults via
`impl.tokens`, but the saved admin tokens always win. This is
intentional: brand color decisions made in the admin shouldn't
revert when an admin tries a different theme.

---

## 8. Registering and Activating

**Install**: register every theme you want admins to be able
to switch into in `nexpress.config.ts`:

```ts
import { defaultTheme } from "@nexpress/theme-default";
import { minimalTheme } from "@nexpress/theme-minimal";
import { mybrandTheme } from "@yourco/theme-mybrand";

export default defineConfig({
  // ...
  themes: [defaultTheme, minimalTheme, mybrandTheme],
});
```

This is a build-time operation — adding or removing themes
requires a redeploy because the React components have to be
in the bundle.

**Activate**: at runtime, an admin opens Settings → Theme and
clicks "Activate" on the desired theme. That writes the id to
`nx_settings.activeTheme` and busts the layout cache via
`revalidatePath("/", "layout")`. The next request renders the
new shell + CSS.

When no `activeTheme` is persisted (fresh install), the
framework falls back to the first theme in the registry. When
the persisted id no longer resolves (developer removed the theme
between deploys), the resolver also falls back to first-registered
rather than 500.

---

## 9. Server vs Client Boundary

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

## 10. Reference Theme Examples

| Package                       | Role in repo                                       |
| ----------------------------- | -------------------------------------------------- |
| `@nexpress/theme-default`     | Full-featured baseline. Use as your starting point. |
| `@nexpress/theme-minimal`     | Sparse / editorial. Demonstrates a stripped shell. |
| `@nexpress/theme-magazine`    | Multi-column layout, hero + sidebar templates.     |
| `@nexpress/theme-portfolio`   | Image-led, gallery-friendly home + project pages.  |

Copy any of them into a new package directory, rename the
manifest id, and start tweaking. The contract is the same; the
only constraint is that your theme's `manifest.id` must be
unique within the registry.

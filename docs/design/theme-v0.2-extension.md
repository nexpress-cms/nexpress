# Theme Contract v0.2 — Extension Plan

> Version: 0.2 (Draft)
> Date: 2026-05-08
> Status: Design phase — locked decisions, ready to implement
> Prerequisites: AGENTS.md theme section + `docs/theme-authoring.md`
>   (v0.1 contract), issue #541 (theme rethink discussion)

---

## 0. Position statement

The realistic ceiling of this work is **content-centric sites**.
Twitter clones, Spotify clones, Figma clones — those are apps,
not CMS sites, and no theme contract reaches them. The ambition
is "everything WordPress themes cover, plus a bit more, without
WordPress's runtime mutation chaos."

Two requirements drive every decision below:

- **Theme developer**: any content-centric site shape buildable
  in React, with no waiting on framework-level layout primitives.
- **Site operator**: from `pnpm install` through "site live and
  customized", **the only CLI step is `pnpm nexpress
  theme:install`**. Everything else happens in admin. Zero code.

These pull in opposite directions — operator-no-code requires
themes to expose machine-readable contracts, theme-developer-
freedom requires those contracts to not constrain implementation.
The contract additions below are designed to honor both.

## 1. Locked decisions

Resolved before this doc was written; restated for the record.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| A | Include `pnpm nexpress theme:install` (CLI AST migration) | **Yes** | Without it, "operator no coding" promise breaks at theme activation. |
| B | Member/community surface skinning | **Out of scope** | `(site)/members/*` carries strong behavior; needs its own track. Theme contract stays presentational for v0.2. |
| C | Reference theme count after rebuild | **3** (`magazine`, `docs`, `portfolio`) | Each presses a different axis. `default` + `minimal` collapse into `magazine` settings variants. |
| D | First implementation order | **F.1 → F.2 → F.3 → ...** | F.2 (routes) is the largest unlock; F.1 (`requires`) is design-only and unblocks F.8. |

## 2. Goals

- Theme developer can express any content-centric site shape using
  arbitrary React + Next.js composition inside the contract.
- Site operator never opens a code editor after running
  `pnpm nexpress theme:install <pkg>`.
- Existing `defineTheme()` callers stay green. All v0.2 fields are
  additive options on `NpThemeImpl` / `NpThemeManifest`.
- Plugin and theme contributions (blocks, patterns, routes) merge
  cleanly through namespacing and clear precedence rules.

## 3. Non-goals

- Runtime collection / schema mutation (themes still can't change
  data shape at runtime — they declare requirements, CLI applies
  them at install time).
- WordPress-style global filter hooks letting themes mutate
  arbitrary framework behavior.
- Member/community surface skinning (deferred to a separate track).
- Page builder becoming a code editor (operator-no-code requires
  the surface to stay declarative).
- Theme-shipped server actions, API routes, or DB schema changes
  (those remain plugin territory).

## 4. Contract additions

Eight phases, each adding optional fields. Existing themes work
unchanged.

### 4.1 Phase F.1 — `manifest.requires`: data shape declaration

**Purpose**: themes declare the collection fields they assume.
F.8's CLI reads this to patch the operator's `src/collections/`.
Admin reads it to warn on activation when fields are missing.

**Shape**:

```ts
manifest: {
  requires?: {
    collections?: Record<string, NpThemeCollectionRequirement>;
  };
}

interface NpThemeCollectionRequirement {
  /** "exists" → just verify presence; "fields" → require these. */
  fields?: Record<string, NpThemeFieldRequirement>;
  /** True → CLI creates this collection if absent. */
  createIfAbsent?: boolean;
}

interface NpThemeFieldRequirement {
  type:
    | "text" | "textarea" | "richtext" | "number" | "boolean"
    | "date" | "select" | "media" | "relationship" | "blocks";
  /** for select */
  options?: string[];
  /** for relationship */
  to?: string;
  hasMany?: boolean;
  required?: boolean;
  /** Required (default: true). False = "nice to have, theme degrades gracefully" */
  hard?: boolean;
}
```

**Deferred to F.8**: actually applying these to user collections.
F.1 only ships the type + admin warning surface.

### 4.2 Phase F.2 — `impl.routes`: declarative dynamic routes

**Purpose**: themes register URL patterns the framework's catch-
all dispatches to. Closes the dynamic-archive gap (`/category/
[slug]`, `/tag/[slug]`, `/author/[id]`, `/:year/:month`, `/search`).

**Shape**:

```ts
impl: {
  routes?: NpThemeRoute[];
  /** Sugar layer over routes for common archive patterns. */
  archives?: NpThemeArchives;
}

interface NpThemeRoute {
  /** path-to-regexp pattern. Examples:
   *   "/category/:slug"
   *   "/tag/:slug"
   *   "/author/:id"
   *   "/:year(\\d{4})/:month(\\d{2})"
   *   "/search"
   *   "/lookbook"
   */
  pattern: string;
  component: ComponentType<NpRouteRenderProps>;
  /** Optional metadata builder for SEO. */
  metadata?: (ctx: NpRouteRenderProps) => Promise<Metadata>;
  /** Optional cache hint — defaults to dynamic. */
  revalidate?: number | false;
}

interface NpRouteRenderProps {
  params: Record<string, string>;
  searchParams: Record<string, string | string[] | undefined>;
  blockCtx: NpBlockRenderContext;
}

interface NpThemeArchives {
  [collectionSlug: string]: {
    byCategory?: { component: ComponentType<NpRouteRenderProps>; pattern?: string };
    byTag?: { component: ComponentType<NpRouteRenderProps>; pattern?: string };
    byAuthor?: { component: ComponentType<NpRouteRenderProps>; pattern?: string };
    byDate?: {
      component: ComponentType<NpRouteRenderProps>;
      granularity: "year" | "month" | "day";
      pattern?: string;
    };
    search?: { component: ComponentType<NpRouteRenderProps>; pattern?: string };
  };
}
```

**Dispatch precedence** (in `apps/web/(site)/[[...slug]]`):
1. App-explicit Next.js route file → Next routes natively, framework
   never sees the request.
2. Theme `routes` (declared order, first match wins) → invoke
   component.
3. Theme `archives` sugar (expanded into routes by framework) →
   invoke component.
4. Page document slug lookup → existing fallback.

App overrides remain authoritative — this preserves operators'
right to write custom Next.js routes when needed (escape hatch).

**Data fetching**: the route component fetches its own data via
`findDocuments` / typed wrappers. Operator tunability comes from
F.3 settings (e.g. `postsPerPage`). Framework provides
`getArchiveQuery({ collection, params, settings })` helper for
the boilerplate path but does not force its use.

**Locale**: framework resolves locale before dispatch; route
component receives it via `getCurrentLocale()` like other RSC.

**Block ctx**: framework constructs a fresh `NpBlockRenderContext`
per request and threads it to the route component, mirroring how
page templates already receive it.

### 4.3 Phase F.3 — `manifest.settingsSchema` + auto-form

**Purpose**: themes expose operator-tunable options without
forcing token-tree extension. Admin auto-renders a form from the
schema; operator never edits code.

**Shape**:

```ts
manifest: {
  settingsSchema?: ZodSchema;
}
```

Zod schema serves three roles:
1. Type inference for `getThemeSettings()` return type.
2. Admin auto-form generation (zod → form fields).
3. Runtime validation when reading from `np_settings`.

**Supported zod field types** (form generator initial coverage):
- `z.string()` → text input. Modifiers: `.url()` → URL input,
  `.regex(/#[0-9a-f]{6}/i)` → color picker (heuristic match).
- `z.number().int().min(N).max(M)` → number input with range.
- `z.boolean()` → toggle.
- `z.enum([...])` → select.
- `z.array(z.object({...}))` → repeating subform.
- `z.object({...})` → nested fieldset.

Each field accepts `.default(value)` and `.describe("Help text")`
which the form generator surfaces.

**Storage**: `np_settings.themeSettings: Record<themeId, unknown>`.
On read, validated against current `settingsSchema`. Validation
failure surfaces as an admin warning toast and falls back to
schema defaults.

**API**:
- Server: `await getThemeSettings()` → `z.infer<typeof schema>`.
  Memoized per request.
- Client: settings flow as props from server parents. Direct
  client hook intentionally omitted (settings rarely change per
  client interaction, and a hook would drag zod into the browser).

**Schema evolution**: v0.2 ships strict `parse()`. Schema change
on theme upgrade → admin shows mismatch banner with "reset to
defaults" action. Migration helpers (`migrate(old, fromVersion)`)
deferred to v0.3 unless field demand surfaces during F.9 rebuild.

**Auto-form infrastructure sharing**: the same form generator
serves plugin config UIs. F.3 builds the generator as a shared
admin primitive (`packages/admin/src/zod-form/`). Plugins that
currently hand-code their config UIs migrate as a followup.

### 4.4 Phase F.4 — `impl.blocks`: theme-shipped block types

**Purpose**: themes ship block types (e.g. `magazine.hero-feature`,
`magazine.three-col-grid`) that participate in the page builder
exactly like plugin blocks.

**Shape**:

```ts
impl: {
  blocks?: NpBlockDefinition[];  // same type plugins use
}
```

**Registration**: bootstrap registers theme blocks alongside
plugin blocks via `getSharedRegistry()`. Theme deactivation
de-registers them.

**Stale instance handling**: when an operator deactivates a theme,
existing pages may have block instances of that theme's types.
v0.2 behavior:
- Renderer (`renderBlocks`) emits a `<NpUnknownBlock>` placeholder
  with the original `type` shown.
- Page builder shows the block as a red error card with the
  block's last-known `props` JSON visible and "Remove" / "Reactivate
  theme" actions.
- A "cleanup unknown blocks" admin action (bulk remove) is **noted
  but deferred to v0.3** — not blocking F.4.

**Namespacing**: theme blocks SHOULD use a namespace prefix
matching the theme manifest id (`magazine.foo` for theme `id:
"magazine"`). The framework does not enforce this in v0.2 but
admin lints against unprefixed types in dev mode. Two themes
shipping the same unprefixed type will see "last loaded wins"
silently — convention-driven, not contract-enforced.

### 4.5 Phase F.5 — `impl.patterns`: composable block presets

**Purpose**: theme ships pre-composed block trees the operator
drops into the page builder as starting points.

**Shape**:

```ts
impl: {
  patterns?: NpBlockPattern[];
}

interface NpBlockPattern {
  id: string;
  label: string;
  /** Optional preview image path, served from theme's public/ */
  preview?: string;
  /** Group in admin pattern picker. */
  category?: "homepage" | "page" | "section" | string;
  /** The block tree expanded on insert. */
  blocks: NpBlockInstance[];
  /** Optional one-line description. */
  description?: string;
}
```

**Builder integration**: page builder gains an "Insert pattern"
side panel grouped by category, with preview thumbnails. On
click, the pattern's `blocks` are deep-cloned with fresh ids and
inserted at the cursor; afterwards, those blocks are regular
editable instances. The pattern itself is read-only metadata.

**Plugin patterns**: plugins gain the same field on
`NpPluginDefinition.patterns`. Theme + plugin patterns merge into
the same registry (namespaced by source id).

### 4.6 Phase F.6 — `impl.navLocations`: nav mount points

**Purpose**: theme declares semantic locations for nav menus;
operator assigns existing menus to locations in admin.

**Shape**:

```ts
impl: {
  navLocations?: Record<string, NpNavLocation>;
}

interface NpNavLocation {
  label: string;
  description?: string;
  maxItems?: number;
}
```

**Theme component usage**:
```tsx
import { NavMenu } from "@nexpress/next/client";
<NavMenu location="primary" />
```

**Admin integration**: extends the nav editor (#429) to include
a "Location assignments" panel where each declared location
shows a dropdown of existing menus (or "— none —"). Persisted
in `np_settings.navAssignments[themeId][locationKey] = menuId`.

### 4.7 Phase F.7 — error / 404 / SEO surfaces

**Purpose**: themes own user-visible chrome on error pages,
sitemap structure, and feed branding.

**Shape**:

```ts
impl: {
  notFound?: ComponentType;
  error?: ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;
  seo?: {
    sitemapItems?: () => Promise<NpSitemapItem[]>;
    feedItems?: () => Promise<NpFeedItem[]>;
    robotsTxt?: () => string | Promise<string>;
  };
}
```

`apps/web/(site)/not-found.tsx` and `error.tsx` (Next conventions)
delegate to the active theme's component when defined; otherwise
render the framework default. Sitemap/feed/robots helpers compose
with `@nexpress/core/seo`'s existing item builders.

### 4.8 Phase F.8 — `pnpm nexpress theme:install`

**Purpose**: the CLI step that closes the operator-no-code loop.
Reads a theme's `manifest.requires`, AST-patches the operator's
`src/collections/` files, runs `pnpm db:generate`, leaves changes
git-staged for review.

**UX flow**:

```
$ pnpm nexpress theme:install @nexpress/theme-magazine
✓ Loaded @nexpress/theme-magazine 0.1.0
  
  Required collections:
    posts (existing) — adding fields:
      + featured: boolean (default false)
      + coverImage: relationship → media (required)
    categories (existing) — no changes
    authors (NEW) — creating with 3 fields
  
  Continue? [y/N] y

✓ Patched src/collections/posts.ts
✓ Wrote src/collections/authors.ts
✓ Generated src/db/generated/collections.ts
✓ Generated drizzle migration: drizzle/0042_add_magazine_fields.sql
  
  Next:
    1. Review the staged changes (git diff --staged)
    2. Run `pnpm db:migrate`
    3. Activate "@nexpress/theme-magazine" in admin → Settings → Theme
```

**Implementation tooling**:
- AST: `ts-morph` for safe TypeScript modifications.
- Migration: `drizzle-kit generate` subprocess.
- Conflict detection: if a target field name already exists with
  a *different type*, abort with "manual merge required" and
  print conflicting locations.
- Dry-run: `--dry-run` prints planned changes, writes nothing.

**Safety invariants**:
- Never overwrites an existing `defineCollection` field — only
  adds missing ones. Type mismatch on existing field = abort.
- All file writes are git-staged before the next step runs, so
  the operator can `git diff --staged` and `git restore --staged`
  if anything looks wrong.
- No DB writes happen in `theme:install`. The migration must be
  applied manually with `pnpm db:migrate`.

**Out of scope for F.8**:
- `theme:uninstall` (removing fields can drop data) → v0.3.
- Cross-theme migration (`theme:install` switching from theme A
  to theme B) → operator runs install on B; A's extra fields
  remain (idempotent, harmless).

### 4.9 Phase F.9 — Reference theme rebuild

**Purpose**: prove the contract by rebuilding three reference
themes against the full v0.2 surface. Each press a different
axis.

| Theme | Stresses |
|-------|----------|
| `@nexpress/theme-magazine` | F.2 archives (category/tag/author/date), F.3 settings (hero variant, accent color), F.4 blocks (hero-feature, three-col-grid), F.5 patterns (homepage compositions), F.6 nav (primary + footer). |
| `@nexpress/theme-docs` | F.2 search route + sidebar slot consuming hierarchy, F.3 settings (version selector, GitHub repo URL), F.5 patterns (callout, code-with-tabs). |
| `@nexpress/theme-portfolio` | F.3 deep settings (grid columns, hover style, project layout variants), F.4 blocks (case-study-hero, image-grid). Tests settings UI limits. |

`packages/themes/default` and `packages/themes/minimal` retire —
absorbed as `theme-magazine` settings variants (`layout: "default" |
"minimal"`).

**Validation gate**: each theme + a recorded demo where an operator
goes `pnpm create nexpress my-site → pnpm nexpress theme:install →
admin only → live customized site`. If any of the three can't
complete that loop, the contract is incomplete and we file a
follow-up phase before declaring v0.2 done.

## 5. Architectural decisions

Resolved before implementation; deviations need a doc update.

### 5.1 Archive route data fetching

**Decision**: route component fetches its own data via
`findDocuments` / generated typed wrappers. Framework provides
`getArchiveQuery({ collection, params, settings })` as a
*helper* (not a wrapper), but does not pre-fetch.

**Why not pre-fetch**: pre-fetching forces a "what does the
theme want?" guess in the framework. Magazine theme wants
"published, in category X, sorted by `featuredOrder` ASC then
`publishedAt` DESC". Docs theme wants "by hierarchy". A pre-fetcher
that handles both balloons. Direct fetch is simpler and matches
how page templates already work.

**Tradeoff**: theme authors rewrite a small fetch boilerplate
per route. The helper covers the 80% case.

### 5.2 Catch-all dispatch cost

**Decision**: linear scan of declared routes per request, ordered
by declaration. `path-to-regexp` per pattern.

For typical themes (~10 routes), per-request matching cost is
sub-millisecond. If a theme declares 100+ routes (unlikely), we
revisit with a trie or build-time codegen of a Next.js route file
per pattern. **Defer optimization until measured pain.**

### 5.3 Theme settings caching

**Decision**: settings fetched once per request from `np_settings`,
parsed by zod, memoized for the request lifetime. Settings change
in admin invalidates via `revalidateTag('np-settings')`.

zod parse cost is ~tens of microseconds for typical schemas —
not the bottleneck. Per-request memoization is enough.

### 5.4 Stale block / pattern instances after deactivation

**Decision**: render placeholder + admin red card; bulk cleanup
deferred to v0.3.

Operators uncomfortable with placeholders can manually delete
unknown blocks per page. The bulk-cleanup tool is a UX
convenience, not a correctness fix.

### 5.5 settingsSchema evolution

**Decision**: v0.2 = strict parse, mismatch → defaults + admin
warning. Migration helpers added in v0.3 if F.9 rebuild surfaces
real friction.

### 5.6 Multi-site / multi-tenant

**Decision**: theme settings keyed by `siteId` via existing
`np_settings.siteId` scoping. Theme code itself stays
process-global (different sites can share the same theme module).

### 5.7 CLI AST-patch safety

**Decision**: never overwrite, only add. Conflict on existing
field → abort with location prints. Dry-run mode required. All
writes git-staged before next step.

### 5.8 Plugin / theme name collisions

**Decision**: namespacing is convention, not contract.
- Block types: theme blocks SHOULD prefix with theme id, plugin
  blocks SHOULD prefix with plugin id. Admin lint warns in dev.
- Routes: theme routes evaluated before plugin routes; both
  evaluated after app-explicit. First match wins, with dev-mode
  warning if a pattern is shadowed.
- Patterns: each registered with `source: "theme:magazine"` or
  `source: "plugin:reading-time"` for admin UI grouping. Same id
  from two sources = silent overwrite (last-loaded wins),
  with dev warning.

## 6. Phase ordering

```
F.1 (requires declaration)        ← design-only, unblocks F.8
  ↓
F.2 (routes + archives sugar)     ← largest unlock; ~2 PRs
  ↓
F.3 (settingsSchema + auto-form)  ← noco core; auto-form is shared infra ~2 PRs
  ↓
F.4 (theme blocks)                ← small; F.5 prereq
  ↓
F.5 (patterns + builder UI)       ← UI heavy ~2 PRs
  ↓
F.6 (navLocations)                ← small, builds on #429
  ↓
F.7 (error/404/seo)               ← small
  ↓
F.8 (CLI theme:install)           ← AST + drizzle integration ~2 PRs, highest risk
  ↓
F.9 (reference theme rebuild)     ← integration test, 3 themes ~3 PRs
```

PR estimate: **~15 PRs over 1–2 months.** Each PR keeps `pnpm
build / typecheck / test` green; tests for new fields land with
the field.

## 7. Validation

The v0.2 contract is "done" when:

1. All eight `NpThemeImpl` / `NpThemeManifest` field additions
   ship with tests.
2. Three reference themes (magazine, docs, portfolio) build
   against the new contract with no per-theme app-level patches.
3. The recorded operator-no-code demo (per F.9) succeeds for all
   three themes.
4. v0.1 themes (the four current ones, until retired) still load
   without modification — fields are all optional.

Failure of any of (1)–(3) blocks the v0.2 release; remediation
either extends the contract (file a new phase) or revises an
existing phase before declaring done.

## 8. Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Admin UI volume balloons (auto-form + pattern picker + nav locations + install dialog) | 🟡 Medium | Share primitives across surfaces (zod-form for theme + plugin config). Build admin patterns library if scope grows. |
| Catch-all route priority bug (app vs theme vs slug) hides pages or bypasses access checks | 🔴 High | Integration tests covering each precedence level. Explicit precedence table in code comments. |
| Stale block instances after theme deactivation confuse operators | 🟢 Low | Placeholder + red card is acceptable; bulk cleanup tool deferred. |
| settingsSchema evolution breaks operator data on theme upgrade | 🟡 Medium | Strict parse + reset-to-defaults banner in v0.2. Migration helpers in v0.3 if F.9 surfaces real demand. |
| CLI AST patch corrupts operator collection files | 🔴 High | Add-only, abort-on-conflict, dry-run, git-staging before next step. Never DB-writes. Heavy unit + integration tests on patcher. |
| Theme/plugin block-type collisions silently overwrite | 🟡 Medium | Convention-driven prefixes, dev-mode lint, `source` field on registry entries. |
| Reference theme rebuild surfaces unforeseen contract gaps | 🟡 Medium | F.9 ordering at the end is intentional — gates v0.2 completion on real-use validation. |

## 9. Backwards compatibility

- All v0.2 additions are optional. v0.1 themes continue to load.
- `defineTheme()` signature unchanged — still identity-pass-through.
- `NpThemeManifest` / `NpThemeImpl` extended with optional fields;
  existing fields untouched.
- Block / route / pattern registries are new — no existing
  consumer to break.
- The four v0.1 reference themes remain in-tree until F.9 retires
  them (replaced by 3 v0.2 themes).

## 10. Deferred to v0.3 (recorded, not abandoned)

Per the agreement to track everything we postpone:

- **`theme:uninstall` CLI** — removing collection fields without
  data loss requires a confirmation flow and possibly a backup
  step. Out of scope for F.8.
- **Bulk "cleanup unknown blocks" admin action** — placeholder
  rendering covers correctness; bulk action is convenience.
- **`settingsSchema` migration helpers** — v0.2 falls back to
  defaults on mismatch. Real migration helpers tracked here.
- **Cross-theme migration** — switching themes A → B is
  idempotent at install time but doesn't remove A's leftover
  fields. Cleanup workflow tracked here.
- **Member/community surface skinning** — `(site)/members/*`,
  member dashboards, community surface components remain
  app-owned in v0.2. Separate track post-v0.2.
- **Plugin config auto-form migration** — F.3 builds the
  zod-to-form generator for theme settings; plugins keep their
  hand-coded config UIs until a follow-up migrates them.

## 11. Open questions for implementation phase

These don't block the design lock, but need answers as code lands:

1. Does `getArchiveQuery` helper live in `@nexpress/core/seo`,
   `@nexpress/next`, or a new `@nexpress/core/archives`? Decide
   when F.2 lands.
2. Does the auto-form generator support `z.discriminatedUnion`
   in v0.2 or wait for v0.3? Decide when F.3 starts.
3. Pattern preview images — bundled in theme `public/` or a
   separate metadata API? Decide when F.5 starts.
4. CLI conflict resolution UI — abort-only (current plan) or
   interactive resolve? Decide when F.8 starts.

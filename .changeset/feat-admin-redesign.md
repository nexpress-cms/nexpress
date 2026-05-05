---
"@nexpress/admin": minor
---

Admin UI — refined visual register ("clean / sophisticated" pass).

Adopts the redesigned NexPress design-system kit
(`ui_kits/admin/index.html`). The shape of the public API is unchanged
(`AdminShell`, `AdminTopbar`, `Card`, `Button`, `Input`, `Select`,
`Tabs`, `Switch`, `Badge` — same exports, same props), but the
rendered surface changes:

- **Brand accent.** `--np-color-brand` (`#0066FF`, sourced from the
  wordmark's blue notch) is wired through `apps/web/src/app/globals.css`
  with `--np-color-brand-soft` and `--np-color-brand-ring`. Used as a
  quiet indicator (active sidebar rail, focus rings, links, progress
  bars) — never as a fill. Adds a `brand` button variant for the rare
  case a CTA wants the wordmark blue.
- **Sidebar (`AdminShell`)** redesigned: smaller width (`w-60`), warm-
  paper background (`#fbfbfa`), hairline border, group eyebrows
  (Workspace / Content / {collection groups} / Multi-site / Community /
  System), brand-blue 2px left rail on the active item, and the new
  `NpMark` SVG wordmark replaces the "NexPress / Editorial control
  center" eyebrow header.
- **Topbar (`AdminTopbar`)** swaps the "Admin / Welcome back, {name}"
  eyebrow + h1 for breadcrumbs derived from `usePathname()` (e.g.
  `Workspace / Dashboard`, `Content / Posts / Edit`). Shorter (52px)
  and the userpill is rounded-full + inline-only.
- **Primitives tightened to a 32px-control register:** `Button` default
  is `h-8` (was `h-10`), `Input` / `Select` are `h-8`, `Tabs` list is
  `h-9`, `Switch` is 32×18. All focus rings switched to a 3px halo at
  `--np-color-brand-ring`. `Card` is `rounded-xl` (12px, was 24px) on
  a hairline border with no backdrop blur; `CardHeader` and `CardFooter`
  add their own divider.
- **Dashboard** drops the "Admin overview" tracked eyebrow for a single
  date headline (`Today, May 3`), tightens stat-card density, runs
  `tabular-nums` on the value, and switches the Collection-pulse
  progress bar to brand-blue with a 4px track.
- **Auth pages** (`/admin/login`, `/admin/forgot-password`,
  `/admin/set-password`, `/admin/setup`) move from raw-Tailwind cards
  to the new exports `AuthLayout` + `AuthCard` (soft brand-blue
  radial-vignette background, hairline-bordered card with the
  `NpMark` wordmark, version + Argon2/JWT footer pill). Login lists
  registered OAuth providers (`listOAuthProviders()`) above the
  email/password form with provider-icon SVGs (GitHub, Google, fall-
  back globe).
- **PageHeader.** New shared component (`PageHeader` from
  `@nexpress/admin/client`) replaces the eyebrow + tracked + 30px h1
  pattern across every admin view (Settings, Plugins, Sites, Site
  members, Members, Reports, Audit log, Pending review, Community
  settings, Background jobs, Collection list, Plugin admin) with a
  consistent `text-[22px]` heading + `text-[13.5px]` description +
  optional actions slot. Page-level surfaces import it directly; ad-
  hoc inline headers (collection edit, media library, user / member
  detail, system health) drop to the same type scale without the
  helper.

Themes that opt into the admin surface inherit these tokens
automatically — there is no opt-in flag. Sites that override
`@theme` color tokens via `generateThemeCss` continue to override
the same names; the brand tokens are additive and don't conflict.

- **Floating panels** (`Dialog`, `Popover`, `Select` content,
  `DropdownMenu` content) drop `rounded-3xl` / `rounded-2xl` and
  `shadow-2xl` for `rounded-xl`/`rounded-lg` with a paired
  `0_20px_50px_-12px` / `0_12px_24px_-12px` shadow stack — the
  refined "ledge of paper" the design calls for. Menu / select item
  rows pick up the new neutral-950/[0.045] hover token used by the
  sidebar so all interactive states share one ramp.
- **DataTable** uses the same hairline border + 36px header height
  as the redesigned activity table on the dashboard. Header cells
  switch to the 11px uppercase tracked-eyebrow style; body rows use
  `text-[13px]` with the lighter divide treatment.
- **SitePicker / ThemeToggle** shrink to fit the 52px topbar.
  SitePicker is now an `h-7` rounded-md trigger with the new brand
  focus ring; ThemeToggle uses `size="icon-sm"` rounded-full.
- **Textarea / Label** match Input's new register (13px text, 12.5px
  label, hairline border, brand focus ring).
- **Body** picks up `font-feature-settings: "ss01", "cv11", "cv02"`
  for the geometric numerals/glyphs the design system commits to.

- **`StatusBadge` + `StatusDot`.** New shared exports — the canonical
  pill+dot pattern from the design (`Published`/`Draft`/`Scheduled`/
  `In review`/`Pending`/`Open`/`Resolved`/`Banned`/`Active`/etc.).
  `collection-list-view`, `collection-edit-view`, `members-list-view`,
  and `reports-queue-view` swap their hand-rolled status pills for it,
  collapsing four nearly-identical color-mapping tables to one source
  of truth.
- **Browser favicon.** New `apps/web/src/app/icon.svg` — Next.js
  picks it up automatically and serves the geometric-N mark as the
  tab icon (matches the sidebar `NpMark`).
- **CardTitle defaults.** `text-lg` overrides removed across every
  admin view that used them; the new `CardTitle` default
  (`text-[13px] font-semibold`) reads correctly without override.

New public exports on `@nexpress/admin/client`:
`NpMark`, `PageHeader`, `AuthLayout`, `AuthCard`,
`AuthCardDefaultFooter`, `AuthDivider`,
`StatusBadge`, `StatusDot`, `StatusTone`.

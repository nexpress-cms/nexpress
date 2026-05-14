---
"@nexpress/theme-docs": minor
---

Theme-docs redesign — three-column reference documentation layout.

Visual surface overhauled to a Stripe/Vercel-style docs site: sticky
header with brand mark + `v0.2` version pill + ⌘K search input
(label + svg + monospace kbd hint) + primary nav + GitHub button;
hierarchical sidebar where each top-level doc becomes a group
**eyebrow** (bullet dot indicator + monospace uppercase label),
its descendants render as nested links with a hairline left rule
and an active-link highlight pulled from the request pathname;
article column carries breadcrumbs (walks the parent chain),
display headline, lede paragraph, meta-pill row (`Stable since X` /
`12 min read` / `Updated <date>` / `Edit this page →`), Lexical-
rendered body with hovered-only anchor icons on h2/h3; right-rail
on-page TOC with a primary-tinted active border + soft gradient;
feedback row and symmetric prev/next pair close the page.

`impl.tokens` overlay sets the new identity — blue `#2563eb`
primary, cool gray neutrals, Geist Sans + Geist Mono with system
fallbacks.

**`requires.collections.docs.fields`** gains three optional
hard:false fields the design uses:

- `lede` (textarea) — short opening paragraph rendered under h1
- `stableSince` (text) — drives the green `Stable since X` pill
- `badge` (text) — sidebar pill (`new` / `beta` / `api`)

Operator-declared fields win on collision so a site that ships its
own `docs` schema isn't overwritten.

**`impl.seedContent.navigation`** ships the design's header nav
(Docs / Reference / Blog) + footer links. Seeding actual doc rows
needs the seedContent contract to grow a `documents?` slot
(targeting non-page / non-post collections) — queued as a
follow-up so this PR stays focused on chrome + tokens.

**Class names** — most align with what the existing components
already emit. New CSS adds `.np-docs-search-kbd`,
`.np-docs-brand-mark`, `.np-docs-page-lede`,
`.np-docs-page-meta-pill`, `.np-docs-breadcrumbs`,
`.np-docs-callout` (info / `--note` / `--warn` / `--danger`),
`.np-docs-code` (file-headed code block with syntax tokens
`.tk-c/k/s/f/t/n/p`), `.np-docs-cmdline` (terminal one-liner —
not `.np-docs-shell`, which already maps to the route shell
container), `.np-docs-steps`, `.np-docs-toc-*`, `.np-docs-anchor`,
`.np-docs-feedback`. Legacy `.np-docs-github-link` continues to
work alongside the new `.np-docs-github`.

The sidebar's auto-current-link detection reads `x-np-pathname`
via `next/headers`; survives server rendering with no client
hydration.

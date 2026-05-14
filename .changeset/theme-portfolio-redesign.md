---
"@nexpress/theme-portfolio": minor
---

Theme-portfolio redesign — image-led dark studio identity.

Last of the four built-in theme redesigns (default #733, docs #734,
magazine #735 already shipped). Refreshes `@nexpress/theme-portfolio`
to a `color-scheme: dark` studio portfolio canvas.

**Header.** Sticky blurred masthead with a display-italic studio
wordmark (literal `&` characters get an accent-color span via
CSS — matches the design's "Owen & Spruce" treatment), centered
primary nav, a small monospaced local-time pill driven by the
new `settings.timezone` (default `Asia/Seoul`), and a "Start a
project" CTA that links to `settings.contactEmail` when set.

**Hero.** Accent-dotted eyebrow, Instrument-Serif display
headline that supports `<em>...</em>` runs for italic-accent
phrases, and three meta blocks (What we do / Selected clients /
Recognition) across a 3-col grid that collapses on phones.

**Controls + grid.** Filter tablist (with `<sup>` count chips) +
grid / list view toggle. The 12-column asymmetric project grid
fills cards by `span` (4 / 5 / 6 / 7 / 8 / 12), defaulting to a
7-5-4-4-8-6-6-12 mosaic when docs don't carry an explicit span.
Eight cover-gradient variants (`a` through `h`) ship for cards
without an image cover; covers scale up gently on hover. Optional
top-left `badge` chip (`accent` variant available for the cover's
featured-corner ribbon).

**Studio strip.** Eyebrow + display headline + body paragraphs
on the left, 2×2 stats grid on the right (each stat lives over
a thin top rule). Hidden entirely when `studioBody` + studioStats
are both empty.

**Contact strip.** Centered booking eyebrow + large mailto link
(Instrument-Serif italic at clamp(2.4rem, 6vw, 5rem)). Hidden
when `settings.contactEmail` is unset.

**Footer.** Single thin row with a green-pulse "Open · Mon — Fri"
clock indicator on the left and Index / Colophon / Built on
NexPress meta links on the right.

**Tokens.** Off-black `#0a0a0a` surface, deep ink-paper foreground
`#f5f1ea`, warm terracotta accent `#d97a4f`, Instrument Serif for
display + Hanken Grotesk for chrome (mono slot points at Hanken
too so kicker / nav letter-spacing reads consistently).

**Schema additions** — `requires.collections.posts.fields` gains
five optional `hard: false` fields the redesigned index template
reads: `discipline` (text), `span` (number), `coverVariant`
(text — one of `a`-`h`), `coverFigure` (text — monogram override),
`badge` (text — corner chip). `featured` is intentionally NOT
re-declared because magazine's `requires` already contributes it
to the prebake union; the gate test catches this and the comment
explains why.

**Settings** — three new fields:

- `timezone` (default `Asia/Seoul`) — drives the masthead's
  local-time pill via `Intl.DateTimeFormat`.
- `contactEmail` — gates the Start-a-project CTA + the contact
  strip's mailto link.
- `bookingNotice` (default `"Currently — booking late 2026"`)
  — short availability eyebrow above the contact mailto.

**`impl.seedContent`** — 9 demo projects shipped via the `posts`
slot, shaped for the asymmetric grid's span pattern. Each
carries explicit `span` / `coverVariant` / `coverFigure` /
`discipline` / `badge` so the demo renders the design's full
mosaic on first boot. Project names are intentionally fictional
(using real institution names as demo clients would imply
endorsement) — operators replace with their actual work once
they're set up.

**Component changes.**

- `header.tsx`: new structure with logo-amp wrapping + local-time
  pill + CTA. Adds a private `formatLocalTime(zone)` helper using
  `Intl.DateTimeFormat`.
- `footer.tsx`: replaced with the design's thin clock-lit meta
  row (left: copyright + Open pulse, right: Index / Colophon /
  framework credit). Optional `aboutCopy` paragraph stays
  available, rendered above the meta row.
- `templates/project-index.tsx`: rewritten — the previous
  template was a single grid; now it composes hero + controls +
  12-col asymmetric grid + studio strip + contact strip as one
  page. Renders projects inline (not via `PortfolioProjectCard`);
  the card component stays exported for sites that embed it
  elsewhere.

**What this does NOT do.**

- Page-builder blocks for the grid. The template renders the
  grid inline; `portfolio.project-grid` / `project-card` page-
  builder blocks would let operators drop the grid on arbitrary
  pages. Deferred — design only shows the index page.
- Diverse authors in seeded projects. All projects attach to the
  seeding admin user; per-author seed wiring is on the deferred
  queue.
- Real / live clock in the header local-time pill. SSR-only; a
  live-ticking clock is a separate client island.

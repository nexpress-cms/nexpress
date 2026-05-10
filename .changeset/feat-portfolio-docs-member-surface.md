---
"@nexpress/theme-portfolio": minor
"@nexpress/theme-docs": minor
---

**Portfolio + docs reference themes adopt the M.\* member-surface
contract.**

Both themes now declare `impl.members.{shell, notFound}` plus a
`./components/members-error` client subpath. Without this, the
F-track fallback chain in `<ShellWrap surface="member">` would
walk back to `impl.shell` + chrome slots, leaving auth forms
stretched across the public site's wide layouts (portfolio is
image-led, docs has a hierarchical sidebar that's useless on
auth surfaces).

**Portfolio** ships:
- `PortfolioMembersShell` — `np-portfolio` root + accent-color +
  card-aspect CSS vars, header + footer chrome, narrow 420-wide
  content column.
- `PortfolioMembersNotFound` — minimal serif heading, stale-auth-
  link copy, `/members/login` CTA.
- `./components/members-error` (client subpath) — same minimal
  voice as the rest of the theme, "Try again" + "Back to sign in"
  CTAs.
- `--np-member-form-*` overrides — transparent input bg,
  hairline borders, theme primary on focus, 0.25rem corners.

**Docs** ships:
- `DocsMembersShell` — drops the sidebar (hierarchical doc nav
  has no place on auth forms), header + 440-wide content column.
- `DocsMembersNotFound` — monospace eyebrow ("404 · account"),
  technical voice.
- `./components/members-error` (client subpath) — monospace
  ("500 · account") eyebrow + same dual-CTA pattern.
- `--np-member-form-*` overrides — 0.375rem corners, monospace
  label accent.

The host's `(member)/error.tsx` registers both new theme entries
in `THEME_MEMBER_ERRORS` alongside magazine's existing entry, so
the active-theme `<style data-np-theme="…">` tag lazy-imports
the correct client chunk when the boundary fires.

Reference impl pattern stays unchanged from magazine (M.ref):
- Member shell wrap component is a Server Component that
  duplicates `<Header />` (and `<Footer />` where applicable)
  inline because `<ShellWrap surface="member">` opts OUT of
  the layout's chrome-slot injection when `impl.members.shell`
  is truthy.
- `notFound.tsx` renders a `<div>`, not `<main>` — the framework
  `<ShellWrap>` already emits the page's `<main>` landmark.
- `error.tsx` uses the F.7.1 client-subpath delegation pattern
  (Next.js requires error.tsx be `"use client"`, so theme error
  UI lives in a separate chunk the host lazy-imports).

Closes the trigger-driven follow-up from
`v0.3-theme-deferred-queue.md`: "portfolio / docs reference
theme adoption of M.\*".

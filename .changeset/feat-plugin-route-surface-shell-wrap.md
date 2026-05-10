---
"@nexpress/web": patch
---

**Plugin route `surface: "member"` shell wrap (v0.2 follow-up to #623).**

Plugin routes that declare `surface: "member"` (forum's
`/discussions/new`, `/discussions/:slug/edit`) now render with
member chrome — `impl.members.shell` + chrome fallback chain —
instead of the site shell. Previously the field was accepted at
the SDK boundary but had no visual effect, documented as
"experimental until PRT.4".

**Architectural change.** Layout-bound shell wrap doesn't work
for surface dispatch — Next.js can't pick a layout based on
runtime data. Shell wrap moves OUT of the layout files and INTO
each page via a new `<ShellWrap surface="site" | "member">`
Server Component. The catch-all picks the surface based on
which plugin route matched.

```
(site)/layout.tsx                   ← only NpThemeStyle + theme CSS + feed link
(site)/[[...slug]]/page.tsx         ← <ShellWrap surface={pluginMatch.route.surface}>
(site)/blog/page.tsx                ← <ShellWrap surface="site">
(member)/layout.tsx                 ← only NpThemeStyle + theme CSS
(member)/members/login/page.tsx     ← <ShellWrap surface="member">
components/shell-wrap.tsx           ← (new) F-track fallback chain inside
```

**Trade-off.** Every page in `(site)` and `(member)` MUST wrap
itself. A page that forgets renders bare body without chrome
(visible regression). Mitigated by:
- Greppable invariant — every `page.tsx` and `not-found.tsx`
  in those trees imports `ShellWrap`. Verified pre-merge.
- Reviewer eye — adding a new page is a deliberate act; the
  pattern is consistent across 16 existing files.
- `pnpm build` still produces all routes; chrome regression is
  visual, not structural.

**`error.tsx` special case.** Next.js mandates `error.tsx` is
`"use client"`. Client components can't import Server Component
`ShellWrap`. Site/member error pages now render their own
`<main>` for semantic correctness and accept the lack of theme
chrome (a stripped error page is a reasonable fallback when the
rendering pipeline broke). Theme-overridden error subpaths
(F.7.1 delegation pattern) keep working the same way.

**F-track contract preserved.** `impl.members.shell`'s null
opt-out, undefined fallback, and chrome-slot inclusion rules
move from `(member)/layout.tsx` into `<ShellWrap surface="member">`
unchanged. Magazine reference theme works end-to-end without
modification.

**Updates v0.1 stability promise** in AGENTS.md (separate
follow-up commit) — `surface: "member"` shell wrap moves from
**experimental** to **stable**. Plugin authors can now rely on
member-surface routes rendering with member chrome.

Files touched: 18 modified + 1 new (`shell-wrap.tsx`), ~668 LOC
of net-positive ~34 LOC (most diff is JSX indentation).

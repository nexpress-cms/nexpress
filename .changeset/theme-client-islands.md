---
"@nexpress/theme-default": patch
"@nexpress/theme-docs": patch
"@nexpress/theme-portfolio": patch
---

Wires three small client-side affordances the themes already
hinted at but didn't actually deliver:

- **`@nexpress/theme-default`** + **`@nexpress/theme-docs`**:
  the masthead ⌘K affordance now works. A new
  `SearchKeyboardShortcut` client island listens for Cmd+K /
  Ctrl+K on `document` and focuses + selects the search input.
  Drops into both themes as a sibling of the search form;
  hidden in the DOM (renders `null`).
- **`@nexpress/theme-docs`**: TOC scrollspy. A new
  `TocScrollspy` client island reads the heading ids the
  template already emits (h2/h3 from `renderRichText`) and
  stamps `aria-current="true"` on the matching TOC anchor as
  the user scrolls. CSS already targeted `aria-current`
  styling, but no walker was emitting the attribute — now there
  is. Uses `IntersectionObserver` with a top-biased margin so
  activation happens when a heading enters the top third of
  the viewport.
- **`@nexpress/theme-portfolio`**: live-ticking local-time
  pill. The masthead's `City · HH:MM` label was SSR-only and
  drifted as the page sat idle. A new `LocalTimeTicker` client
  island re-derives the same `Intl.DateTimeFormat` output once
  a minute, aligned to the next minute boundary so all
  visitors see the rollover at the same wall-clock second.
  SSR initial label is reused as the first state — no
  hydration flicker.

Each island is module-scoped, mount-only side effects, and
disposes its listener/observer on unmount. None of them ship
new operator-visible settings; they're polish on the chrome
the themes already render.

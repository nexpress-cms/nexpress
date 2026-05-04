---
"@nexpress/admin": patch
---

PagePicker (the search-as-you-type page combobox in the nav
editor) gains two accessibility / UX polish bits:

- **Scroll-into-view on arrow-key navigation.** The result list
  is height-capped to ~5–7 rows; ArrowDown past the visible
  window now calls `scrollIntoView({ block: "nearest" })` on the
  active row so the highlight stays visible. `nearest` is the
  important detail — it only scrolls when the row is actually
  clipped, so already-visible rows don't trigger a jolt.
- **WAI-ARIA combobox pattern.** Input gets
  `role="combobox"` + `aria-expanded` + `aria-controls` +
  `aria-activedescendant` + `aria-autocomplete="list"`. Result
  container becomes `role="listbox"`. Each row becomes
  `role="option"` with `aria-selected={index === activeIndex}`.
  Screen readers now announce "1 of N" + the focused option's
  text on arrow-key navigation, even though DOM focus stays on
  the input. No visual change.

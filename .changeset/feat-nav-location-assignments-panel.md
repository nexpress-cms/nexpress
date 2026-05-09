---
"@nexpress/admin": minor
"@nexpress/web": patch
---

**F.6.1 follow-up — nav editor "Location assignments" panel.**

The v0.2 theme contract lets themes declare nav slots with
`navLocations: { primary: { label, description, maxItems } }`,
and `getActiveThemeNavLocations()` already exposed those to the
admin. The locations endpoint returned label + description +
maxItems + source (default / theme / custom), but the editor
silently dropped everything except value/label and rendered
locations as a flat select.

Operators couldn't tell:

- Which slots their theme actually consumes (vs the framework
  defaults `header` / `footer` / `main`)
- What each slot is for (the description never surfaced)
- Whether a slot is empty before publish (theme expects 6
  footer-social links; you have 0)
- Whether they've gone past the slot's `maxItems` (theme says
  max 6, operator added 8 — items 7-8 will silently render
  past the layout and look broken)

This PR adds a "Location assignments" panel above the items
list. It renders only when ≥1 theme-declared location exists,
showing each as a clickable card with:

- Label + slug
- Description (italic, small)
- Live item count (current location pulls from the in-editor
  state for unsaved-edit awareness; other cards show the
  last-saved count returned by the API)
- Status badge: `Empty` (amber) / `N / max` (green) /
  `N / max over` (red, when over-limit)
- "Editing" indicator on the active card

Click → switches to that location (with the existing dirty-edit
guard).

The classic `<Select>` switcher in the header still works for
keyboard-driven full-list switching incl. defaults + custom
locations.

### API change (back-compat)

`/api/navigation/locations` now returns `itemCount: number` on
each entry. The editor's parser narrows defensively, so older
deploys where the field is absent still render correctly (count
treated as 0 → "Empty" badge).

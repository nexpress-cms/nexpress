---
"@nexpress/admin": patch
---

feat(admin): empty-state Card when every sidebar group is hidden by kind (10/14)

PR 10 of the editor progressive-disclosure sequence. Closes the
edge where every sidebar group's fields are hidden by their
`admin.condition` — sidebar would otherwise show just the
"Show all fields" toggle with no Card below, which looks broken.

The empty-state Card explains why the sidebar is empty (kind
filter) and offers an inline action that flips `showAllFields`
to `true`, surfacing every field. Operators hit this when:

- They switch a post's kind in the editor and every field of
  the previous kind disappears
- A theme contributes fields all gated to a kind they're not
  using
- A custom collection has fields all condition-hidden by some
  edge state

## Behavior

- Renders only when `sidebarGroups.length === 0` AND
  `hasHiddenFields === true` (existing "no fields configured"
  fallback stays for collections without sidebar fields at all)
- Inline "Show all fields" button toggles `showAllFields` to
  `true`, which immediately repopulates the sidebar
- Brand-colored underline-on-hover for the action — matches the
  rest of the admin's link styling

## Test plan

- [x] admin build + typecheck clean
- [ ] Browser: switch a post's kind so every sidebar field
  hides → empty Card appears with the action
- [ ] Click "Show all fields" inside the Card → sidebar
  repopulates with all groups including the hidden-by-kind ones

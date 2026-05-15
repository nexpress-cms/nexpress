---
"@nexpress/admin": patch
---

feat(admin): auto-expand sidebar group containing a validation error (7/7)

Closing PR of the editor progressive-disclosure sequence. PR 6
shipped toast + auto-focus on Save failure, but if the failing
field sat inside a collapsed `SidebarGroupCard` the focus +
scrollIntoView fired against a hidden element. This PR
force-opens any group whose field has a current validation
error.

## Mechanism

`SidebarGroupCard` gains an optional `forceOpen?: boolean` prop.
When true, the Collapsible renders as open regardless of the
user's localStorage-persisted preference. Local state still
tracks the operator's intent — once errors clear (operator
fixes the field, submit succeeds), the force lifts and the
card reverts to whatever the user had set.

The parent `CollectionEditView` walks each `sidebarGroups`
entry, checks `form.formState.errors` for any field in that
group, and passes `forceOpen={hasError}` to the matching card.
Reactive: as the operator fixes the field, the error clears
and the force-open lifts; if they collapse the card during the
force, the local state captures that and applies once force
lifts.

## Edge handling

- **User clicks the trigger while force-open**: the click still
  updates local state via `setOpen`. UX-wise the card stays
  open (forceOpen wins for `effectiveOpen`), but the
  preference is captured. Once force lifts, the card honors
  the captured preference.
- **ARIA wiring**: `aria-expanded={effectiveOpen}` reflects the
  actually-visible state, not the user's preference. Screen
  readers announce the real state.
- **Chevron rotation**: tied to `effectiveOpen` for the same
  reason.

## What's left as polish (not blocking)

- **Nested-group errors** still don't aggregate (see PR 6
  flag). If a `group` field's nested required fails, RHF
  surfaces the leaf path (`seo.metaTitle`) but my
  `group.fields.some((f) => errors[f.name])` checks only
  top-level names. Pre-existing gap. Trivial recursive check
  to fix when a real consumer needs it.

## Test plan

- [x] `@nexpress/admin` build + typecheck clean
- [ ] Browser: collapse the SEO group → click Save with required SEO field empty → group auto-expands, focus lands in the failing input, toast names it
- [ ] Fix the field → submit succeeds → next reload the group stays in whatever state the operator left it

---
"@nexpress/admin": patch
"@nexpress/app": patch
---

feat(admin, app): editor a11y + motion polish (5/7)

PR 5 of the editor progressive-disclosure sequence. Cleans up
the smaller a11y / interaction loose ends queued from PRs 1-4.

## Sidebar group collapse animation

PR 2 wired the collapse interaction but Radix Collapsible
needs CSS keyframes to animate; without them the content
snaps open / closed. Added `np-collapsible-slide-down` /
`np-collapsible-slide-up` keyframes in
`@nexpress/app/styles/globals.css` interpolating
`--radix-collapsible-content-height` over 180ms. Targeted via
the `np-sidebar-group-content` marker class so other Radix
Collapsibles in the admin aren't accidentally restyled.

## Focus ring on the group header

The header was clickable (`role="button"`, `tabIndex=0`) but
had no `:focus-visible` style — keyboard users couldn't see
which group was about to toggle. Added
`focus-visible:ring-2 focus-visible:ring-[var(--np-color-brand)]`
matching the rest of the admin's focus treatment.

## `aria-controls` id sanitization

The id contained dots from `storageKey`. HTML allows dots in
ids but CSS attribute / id selectors break, and dev-tools
navigation is friendlier with hyphens. Replaced with
`.replace(/\./g, "-")` so the id is `np-sidebar-group-posts-Publish`
rather than `np-sidebar-group-np-admin.sidebar-group.posts.Publish`.

## Show-all toggle label association

The toggle's text was a `<span>` with no `<label htmlFor>`
wiring to the Switch — screen readers had to rely on the
Switch's `aria-label` alone. Added an explicit `<label>`
pointing at the Switch's id; the existing `aria-label` stays
for SRs that prefer it.

## What does NOT change

- Default open/closed state — same as PR 2.
- Toggle visibility logic — same as PR 1.
- localStorage key shape — same.

## Test plan

- [x] `@nexpress/admin` build + typecheck clean
- [ ] Browser: click sidebar group header → smooth 180ms slide
  animation.
- [ ] Keyboard: tab to group header → visible focus ring;
  Enter / Space toggles.
- [ ] Screen reader: clicking the toggle's text label moves
  focus to the Switch.

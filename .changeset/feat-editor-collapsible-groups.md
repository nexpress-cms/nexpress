---
"@nexpress/admin": patch
---

feat(admin): collapsible sidebar group cards in the document editor (2/7)

Builds on #756 — the foundation PR introduced sidebar groups
but rendered each as an always-expanded Card. This PR makes
each group Card collapsible: clicking the header toggles, the
chevron rotates, the content slides via Radix Collapsible's
built-in animation.

## Why this instead of tabs

The original 7-PR plan had tabs as #2 (Content / SEO / Settings
/ Advanced). Reconsidered post-foundation: WordPress, Sanity,
Ghost, Notion all use scrollable grouped sidebars for post
editors — not tabs. Tabs split content into distinct
workspaces; post editing is one workspace centered on the body,
with the sidebar as a glance-target. Collapsibles give 80% of
tabs' visual decluttering without the context-switch cost.

If after PRs 3–6 the editor still feels crowded with SEO +
media + theme-specific groups, layering tabs on top stays
available as a future addition.

## Behavior

- Each sidebar group Card has a chevron in its header.
- Clicking the header toggles open/closed; keyboard support via
  Enter / Space on the focused header (role="button",
  tabIndex=0).
- Default: all groups expanded. Pre-collapsing essential groups
  (Publish, Lead) would hide common editing targets behind a
  click; trading visual decluttering for an extra interaction
  per session isn't the right trade for content authoring.
  Operators collapse what they personally don't use.
- State persists per-collection per-group via localStorage
  (`np-admin.sidebar-group.<slug>.<groupName>` → `"open"` /
  `"closed"`). Same scoping rule as the existing show-all
  toggle.
- `aria-expanded` + `aria-controls` wire the trigger to the
  content for screen readers.

## What does NOT change

- Field grouping logic (foundation in #756) — unchanged.
- Default sidebar layout for fresh operator — all groups
  expanded. The collapse-by-default question lands in a
  separate UX decision PR if operators ask.
- Main column rendering — unchanged.

## Test plan

- [x] `@nexpress/admin` build + typecheck clean
- [x] Lint count unchanged
- [ ] Browser: click sidebar group header → collapses with
  animation, chevron rotates. Reload page → group stays
  collapsed. Toggle other groups independently.
- [ ] Keyboard: tab to group header → Enter / Space toggles.

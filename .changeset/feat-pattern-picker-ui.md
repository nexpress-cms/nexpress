---
"@nexpress/admin": minor
---

**F.5.1 — pattern picker UI: category bands + preview thumbnails.**

The Cmd-K command menu's "Pattern" group used to render a flat
list of `Insert pattern: <label>` actions. Theme + plugin
contributors set `category` ("homepage" / "page" / "section"
/ ...) and `preview` (image URL) on `NpPattern` since F.5,
but the picker ignored both.

This PR enhances the picker:

- **Category bands** — within the Pattern group, actions
  group by `pattern.category`. Each non-null category renders
  as a sub-header (Title-cased). Patterns without a category
  fall into the un-headered band first.
- **Preview thumbnails** — when `pattern.preview` is set, a
  24px × 36px thumbnail renders at the left of the action
  label. Built-in / custom patterns without preview render
  text-only.

### Surface change

`CommandAction` gained two optional fields:
- `subgroup?: string` — generic sub-header within a group.
  Patterns use it for their category; other groups ignore.
- `preview?: string` — thumbnail URL. Tiny `<img>` rendered
  inline in the action button.

`groupCommandActions` now returns nested `CommandSubgroup[]`
inside each `CommandGroup`. Items without a subgroup go into
the first un-headered band so existing groups keep their flat
look. `bucketBySubgroup` preserves declaration order (no
alphabetical sort) — operators see patterns in the order
their themes / plugins specified.

### What this enables

Theme authors can now ship visual patterns with proper
discovery:

```ts
// in @nexpress/theme-magazine's patterns.ts
{
  id: "magazine.homepage-feature-grid",
  label: "Homepage: feature + grid",
  description: "...",
  category: "homepage",
  preview: "/themes/magazine/preview.png",
  source: "theme:magazine",
  blocks: [...],
}
```

The Cmd-K picker shows it under a "Homepage" sub-header with
the preview image. Operators glance once and pick.

### What's not in this PR — F.5.2 follow-up

- **Dedicated side panel** — the design doc envisioned a
  separate "Insert pattern" side panel rather than the Cmd-K
  menu. The category-banded picker hits 80% of the value;
  side panel is bigger UI work (state-mgmt, animation, mobile
  layout) for the remaining polish.
- **Search within Pattern** — current filter applies across
  all groups. A pattern-only search mode (or a dedicated
  search box inside the side panel) is part of F.5.2.

### Test plan

- [x] @nexpress/admin build + typecheck clean
- [x] @nexpress/web typecheck clean
- [ ] Manual: install a theme with patterns that set
  `category` + `preview`, hit Cmd-K, confirm:
  - Pattern group shows category sub-headers
  - Preview thumbnails render inline
  - Pattern click still inserts the block subtree
  - Built-in / custom patterns without category fall into the
    first un-headered band

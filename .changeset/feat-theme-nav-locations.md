---
"@nexpress/core": minor
"@nexpress/theme": minor
"@nexpress/next": minor
"@nexpress/web": patch
---

**Phase F.6 — `impl.navLocations` + `<NavMenu>`: theme-declared nav mount points.**

Sixth implementation phase of the v0.2 theme contract extension
(see `docs/design/theme-v0.2-extension.md` §4.6). Themes declare
the semantic nav locations they consume in their shells / slots
(`primary`, `footerLinks`, `mobileDrawer`, etc.); the admin nav
editor populates its location dropdown from this declaration so
operators see friendly labels instead of having to type a
location string from memory.

### Surface added

#### `@nexpress/theme`
- `NpThemeImpl.navLocations?: Record<string, NpThemeNavLocation>`
- `NpThemeNavLocation` — `{ label, description?, maxItems? }`

#### `@nexpress/core`
- `extractNavLocationsFromImpl(impl)` — pure extractor for unit
  testability (no DB roundtrip).
- `getActiveThemeNavLocations()` — async wrapper that resolves
  the active theme then extracts.
- `NpThemeNavLocationDescriptor` — flat output shape with
  `{ key, label, description?, maxItems? }`.

#### `@nexpress/next`
- `<NavMenu location="..." />` server component. Reads
  `getNavigation(location)` for the current site and renders an
  `<ul>` of items. Themes that need richer markup (mega-menus,
  mobile drawer) call `getNavigation` themselves.

#### `apps/web`
- `/api/navigation/locations` now merges theme-declared
  locations alongside framework defaults and operator-authored
  customs. Each entry carries `source: "default" | "theme" |
  "custom"` so the editor can distinguish them; theme-declared
  keys win on collision (e.g. magazine relabeling `header` →
  "Site Header").

### Operator-no-code flow

Today the operator types location strings (`header`, `footer`,
`main`, plus whatever they remember). With F.6, themes that
declare `navLocations` push their slot names into the dropdown
with descriptive labels — no string memorization required.

### Theme component usage

```tsx
import { NavMenu } from "@nexpress/next";

export function MagazineHeader() {
  return (
    <header>
      <h1>Magazine</h1>
      <NavMenu location="primary" />
    </header>
  );
}
```

Themes can also pass `renderItem` for custom item rendering or
omit `<NavMenu>` entirely and call `getNavigation` directly when
the markup gets richer.

### What's not in this phase (deferred)

- **Nav editor "Location assignments" panel** — design doc §4.6
  envisions a dedicated panel listing each theme location with
  a menu-id dropdown (`navAssignments[themeId][locationKey] =
  menuId`). Today's editor surfaces the locations through the
  existing dropdown; a redesign with descriptions, maxItems
  hints, and a "filled vs empty" indicator is **F.6.1
  follow-up**. Operators can already author all locations
  through the existing editor — this is UX polish.

### Tests

6 new unit tests in `packages/core/src/themes/nav-locations.test.ts`:
- Empty when impl undefined / no navLocations / wrong type
- Extracts declared locations with all fields
- Skips entries missing a label (duck-type guard)
- Ignores non-string description / non-number maxItems

Total core tests: 314 (was 308).

### Dependency note

`@nexpress/next` gains a `react` peer dep (`^19.0.0`) and JSX
configured in tsconfig — required for `<NavMenu>`. Existing
non-component exports unchanged. `@nexpress/next` was already
in the host app's `serverExternalPackages` list, so adding
React doesn't risk dragging server-only modules into the
client bundle.

---
"@nexpress/blocks": patch
---

**F.4 follow-up — registry collision warnings.**

Per design doc §5.8 namespace decision:
> Same id from two sources = silent overwrite (last-loaded
> wins) with dev warning.

F.2's `collectThemeRoutes` already had this for routes. F.4 +
F.5 stamped `source: "theme:<id>"` / `"plugin:<id>"` on
blocks + patterns but the registries silently overwrote on
collision without surfacing the conflict.

This PR adds the dev-mode `console.warn` for both `registerBlock`
and `registerPattern`, with the same once-per-process dedup
pattern used elsewhere.

### Rules

| Scenario | Warns? |
|---|---|
| First registration | No |
| Same source re-registers (HMR / cold-start re-boot) | No |
| Built-in default getting overridden by theme/plugin | No (intentional override) |
| Two different non-default sources register the same `type` / `id` | **Yes**, once per process |

The "intentional override" exemption matches the v0.2 contract:
themes can replace built-ins (e.g., a magazine theme shipping
its own `gridBlock` to add editorial defaults). Plugin →
plugin or theme → theme collisions, however, are author errors
worth surfacing.

### Why warn instead of throw

`registerBlock` runs on every cold boot AND on plugin reload.
A strict throw would make HMR + dev iteration painful when a
plugin author renames a type. Warn keeps the dev loop moving
while making the silent overwrite visible. Last-loaded still
wins (existing contract).

### Tests

11 new unit tests in `packages/blocks/src/registry.test.ts`:
- 6 for blocks (first registration, same-source idempotent,
  built-in override allowed, cross-source warn, warn-once,
  plugin↔theme cross)
- 5 for patterns (same coverage minus plugin↔theme since
  patterns share the test path)

Total `@nexpress/blocks` tests: 29 (was 18).

### Test-only fix

`render: () => null` in test stubs was technically incorrect —
`NpBlockDefinition.render` returns `ReactElement` (or
Promise), not `null`. Replaced with a typed stub that the
type system accepts. Existing source tests fixed at the same
seam.

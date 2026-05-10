---
"@nexpress/next": patch
---

**PRT.2 — plugin page-route dispatcher + catch-all integration (#623).**

Plugin-contributed `pageRoutes` declared via PRT.1's `definePlugin({ pageRoutes })`
now actually serve requests. The `(site)` catch-all dispatches in this
order:

1. **Page slug** — operator-authored content always wins.
2. **Slug history redirect** — renames don't break links.
3. **Theme route** — F.2 dispatcher (existing behavior).
4. **Plugin route** — new in this phase.
5. `/` empty-state → `notFound()`.

Same precedence applies in `generateMetadata` so plugin-rendered
URLs emit plugin SEO instead of falling back to page metadata
defaults.

Public surface added on `@nexpress/next`:

- `dispatchPluginRoute({ localeAwarePath, themeRoutes })` — async,
  walks `getPluginPageRoutes()` in registration order, skips
  disabled plugins via `isPluginEnabled`, returns the first match.
- `buildPluginRouteRenderProps({ match, searchParams, blockCtx })`
  — symmetric with `buildRouteRenderProps`; produces the same
  `NpRouteRenderProps` shape so theme + plugin routes share the
  component contract.
- `NpPluginRouteMatch` interface — narrows the registry's
  `unknown` component to `ComponentType<NpRouteRenderProps>`. The
  `@nexpress/core` plugin host stays React-free at the type level
  (peer-dep boundary); the dispatcher is the right seam to assert
  it.

Kept module-internal (not on the public surface) to avoid
committing to APIs no consumer needs yet:

- `dispatchPluginRouteSync` — sync variant with a callback-driven
  `enabled` gate. Used by the dispatcher's own tests; can be
  promoted later if a real consumer surfaces (e.g. an admin
  preview).
- `__resetPluginCollisionWarnings` — test hook for the once-per-
  pattern-per-process dedup; matches F.2's
  `__resetCollisionWarnings` (also internal-only).

**Boot/runtime warnings.** The dispatcher logs once-per-process
when:

- a theme pattern shadows a plugin pattern (theme > plugin
  precedence — locked decision §2.3 of the design doc), or
- two plugins claim the same pattern (first registered wins).

Both warnings name the conflicting pattern + plugin id(s) so an
operator can diagnose without spelunking through the registry.

**Scope deliberately tightened.** PRT.2 ships the dispatcher and
catch-all wiring; two pieces from the design doc are deferred:

- `surface: "member"` shell wrap — needs a parallel `(member)`
  catch-all because `impl.shell` ≠ `impl.members.shell`. Lands
  in PRT.4 alongside the admin Plugins UI surface. For PRT.2,
  `surface: "member"` routes still match and render, but inside
  the site shell. Operators get the route working today; the
  shell distinction lands once the member catch-all is in.
- `locale: "none"` — only the catch-all's locale-stripped path is
  forwarded today. Almost no real plugin needs `"none"`;
  promoting it requires plumbing the raw path through bootstrap.
  Deferred to v1.x.

19 new tests in `packages/next/src/route-dispatcher.test.ts`:

- match (literal, :param, normalized leading slash, segment count)
- first-registered-wins, disabled-plugin-skip, enabled fall-through
- defense against primitive `component` value
- preserve `surface` / `locale` on the match
- async variant with the production `isPluginEnabled` gate
- collision warnings (theme-shadows-plugin, plugin-vs-plugin)
- once-per-pattern-per-process dedup

92/92 in `@nexpress/next`.

Drive-by fix: `bootstrap.test.ts`'s `vi.mock("@nexpress/core")`
was missing `getOptionalRateLimiter` (added in #621). Two
pre-existing test failures cleared.

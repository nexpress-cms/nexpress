# Plugin Page Routes — Design Decisions

Historical summary of the 2026-05-10 proposal. Plugin page routes are now
implemented; the draft's “implementation hasn't started” status, type sketches,
phase checklist and reference-app migration instructions are obsolete.

Use [plugin pages](../plugin-pages.md), [Forum](../plugin-forum.md),
[custom routes](../custom-routes.md) and [theme authoring](../theme-authoring.md)
for current contracts. Original detail remains in Git history.

## 0. Position statement

Plugins need to ship their public pages with the package so operators do not
have to copy routes from the reference app. Explicit host registration keeps
routing inspectable and preserves operator control.

## 1. Inventory of the surface

Theme pages, plugin public pages, plugin API handlers and Admin extensions are
different surfaces. The proposal added public page registration; it did not
make filesystem routes or arbitrary Next.js conventions plugin extension points.

## 2. Locked decisions (final unless re-opened)

The retained decisions are explicit `pageRoutes`, host-owned dispatch, theme
control over presentation, site/member shell selection, per-route locale mode,
and request-time plugin activation checks. Registered order resolves plugin
collisions; diagnostics make shadowing visible.

The draft's abbreviated precedence list, automatic member-gate claims, styling
limits and version promises are not current contracts. Use the live guide for
the complete precedence chain, `surface` versus access control and locale
handling. A member shell does not replace the
route's authorization checks. Installation remains a trusted code decision.

## 3. Goals

A packaged plugin should provide its usable public surface, inherit the active
theme, and disappear from routing when disabled for the current site. Theme
and operator overrides must retain their documented precedence.

## 4. Non-goals

This proposal did not add a general plugin middleware engine, filesystem route
injection, or a second rendering framework. Avoid rebuilding those abstractions
without an actual consumer and an explicit contract.

## 5. Contract additions

The SDK owns route declarations, Core owns registration and activation, and
Next owns dispatch and rendering. Current types and examples belong in the
[plugin page guide](../plugin-pages.md), not a second design-time schema.

## 6. Reference implementation plan

Forum was the motivating consumer. Its public routes now live with the plugin;
reference/scaffold wiring consumes the shared application. The old
`/discussions/*` migration sketch is not an installation recipe for current Forum.

## 7. Risk register

Route shadowing, disabled-plugin leakage, mismatched shells, locale ambiguity
and style conflicts remain the relevant risks. Preserve activation, routing,
authorization and rendering tests at their owning layers.

## 8. Phasing

The PRT.1–PRT.6 sequence described the initial implementation. It is historical,
not a current task list or release authorization.

## 9. Deferred (record, don't lose)

The original deferred ideas were per-route middleware, explicit plugin-to-plugin
override maps, filesystem route injection and prerender/ISR hints. They were
research candidates, not commitments; this cleanup does not authorize them.

## 10. Open questions (must resolve before implementation)

The proposal asked about member-shell fallbacks, discovery metadata and wildcard
patterns. Consult the live route grammar, shell and discovery contracts instead
of treating those old questions as missing implementation.

## 11. NOT in scope

Admin routing, plugin-specific error boundaries and a new route data-fetching
layer were outside this proposal. Existing host services retain ownership.

## 12. Success criteria

Acceptance is a real packaged plugin route journey: install, dispatch, theme
override, authorized member interaction and site-scoped disablement. Collision
and locale cases must exercise the production dispatcher. The historical list
is not evidence that a particular build passed; use [testing](../testing.md).

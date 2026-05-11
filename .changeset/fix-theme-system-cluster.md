---
"@nexpress/web": patch
"create-nexpress": patch
"@nexpress/theme": patch
---

**Theme-system cleanup cluster — closes #600, #601, #602, #607, #610.**

Five small fixes against the theme system, batched. None of
them are user-facing breakage; they're correctness regressions
that piled up across the v0.2 / theme-system work and would
have surfaced as confusing behavior over time.

**#610 — theme-minimal stale references.** The `theme-minimal`
package was retired in #590 but three integration tests still
imported it (`theme-switcher`, `theme-render`,
`theme-layout-swap`) and `packages/theme/README.md` still
listed it. Tests migrated to `theme-magazine` (matching the
"magazine modifier" / `np-magazine-header` assertions);
README's "Reference themes" list now reflects the actual four
shipped themes.

**#601 — theme error delegation depended on `impl.css`.** The
(site) / (member) layouts only emitted `<style
data-np-theme="...">` when `impl.css` was truthy. A theme that
shipped a client error subpath but no theme-owned CSS would
silently fall back to the framework default error page because
the boundary's `useActiveThemeId()` reads that data attribute.
Now both layouts emit an empty `<style data-np-theme="...">`
marker when a theme is active even if its CSS string is empty.

**#600 — block cleanup tool treated inactive-theme blocks as
known.** `/api/admin/blocks/unknown` built its known-types set
with the unfiltered `getRegisteredBlocks()`, which includes
every installed theme's blocks regardless of active state.
After switching themes, `magazine.*` blocks remained "known"
on a `portfolio`-active site, so the cleanup tool reported
nothing for the exact theme-switch flow it advertises. Now
the scan uses `getRegisteredBlocksForActiveSources({ themeId
})`, aligning with how the public renderer treats those
instances (placeholder rendering).

**#607 — page-builder preview used wrong render context.** The
preview API (`/api/admin/preview-blocks`) called
`createDefaultBlockRenderContext()` — no active-source filter —
so the iframe rendered inactive-theme blocks normally while
the public site showed placeholders. Preview disagreed with
production output. Now uses
`createSiteScopedBlockRenderContext()`, matching the catch-all.

**#602 — scaffold admin layout skipped active-theme filter.**
The reference `apps/web` admin layout filters block metadata
+ patterns through the active-source context (#590, F.5), but
the `create-nexpress` template still emitted unfiltered
`getRegisteredBlockMetadata()` / `getRegisteredPatterns()`.
Freshly scaffolded apps would surface every installed theme's
blocks in the editor regardless of which was active. Template
now mirrors the reference app's filter.

No new tests — each fix is verified by the existing integration
suites (which were broken by #610's stale refs anyway, now
restored). Repo typecheck + lint + unit tests all green.

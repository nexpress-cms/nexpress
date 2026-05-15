---
"@nexpress/theme-magazine": patch
---

Restore RTL-safety gate on the magazine theme + relax the
brittle tagline assertion that drifted in #735.

CI's integration job (restored on push) caught two real
violations that slipped through when #735 (magazine redesign)
landed:

- The drop-cap on the first paragraph of a feature article used
  `float: left` and the byline link used `margin-left: auto`,
  plus the secondary-row reset used physical `padding-left/
  right`. The repo's RTL-safety gate at
  `apps/web/tests/theme-magazine-portfolio.integration.test.ts`
  forbids physical-direction CSS — RTL locales would mis-align
  the drop-cap, byline, and row gutters. Migrated to logical
  equivalents (`float: inline-start`, `margin-inline-start`,
  `padding-inline`). No visual change in LTR sites; RTL sites
  now mirror correctly.
- `apps/web/tests/i18n-strings.integration.test.ts` pinned the
  exact magazine tagline (`"Stories, essays, and reports"`)
  which #735 swapped for the "Long-form reporting on craft…"
  copy. The test is now structural — it asserts the bundle
  resolves to a non-empty string per locale and the two locales
  differ. Tagline content can evolve without churning the test
  suite.

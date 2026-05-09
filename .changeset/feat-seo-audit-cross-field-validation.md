---
"@nexpress/plugin-seo-audit": patch
"@nexpress/core": patch
---

feat(seo-audit, core): re-enable seo-audit `.refine()` cross-field validation, pin introspector regression tests

Closes the second G-track follow-up tracked in `docs/design/plugin-config-auto-form.md` § 10. The earlier diagnosis was wrong: Zod 4 implements `.refine()` as a `checks` array on the same `z.object`, **not** as an effects/pipe wrapper, so `_def.type` stays `"object"` and the introspector walks the shape unchanged. Verified by direct probe — a refined schema introspects identically to its unrefined twin.

**`@nexpress/plugin-seo-audit`**:

- Re-added the cross-field refines that G.2.3's self-review had punted on: `titleMin <= titleMax` and `descriptionMin <= descriptionMax`. A misconfigured min/max pair where min > max is unrecoverable in the audit logic (the "short-X" branch always wins for any value < min, so "long-X" is unreachable). The refine rejects at save time, so the operator notices the misconfiguration immediately rather than wondering why long-title warnings never fire.
- Inline comment in `configSchema` records the corrected diagnosis so the next person doesn't re-derive the wrong "wrapper breaks introspection" theory.

**`@nexpress/core`**:

- 2 new regression tests in `themes/settings-schema.test.ts` covering single `.refine()` and chained `.refine().refine()` schemas. Pin the no-op-for-introspection contract so future Zod upgrades don't regress quietly.

`docs/design/plugin-config-auto-form.md` § 10 entry struck through with the corrected diagnosis pointing at this PR.

Verified
- `pnpm --filter @nexpress/core test` — 366 tests
- `pnpm --filter @nexpress/plugin-seo-audit test` — 12 tests
- `pnpm typecheck` (58/58) ✓
- `pnpm build` (31/31) ✓

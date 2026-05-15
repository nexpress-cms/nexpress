---
"@nexpress/core": patch
---

fix(core): config Zod schema accepts the serializable `admin.condition` expression form

#764 widened the TypeScript type of `admin.condition` to accept
either a function or a serializable expression object, but
`collectionConfigSchema`'s `fieldBaseSchema.admin.condition` was
still constrained to `functionSchema`. Booting any site whose
config had migrated to the expression form (built-in posts,
theme-docs, theme-magazine, theme-portfolio) crashed at
`defineConfig`'s validation step with "admin.condition: Invalid
input".

`apps/web/tests/system-health-checks.unit.test.ts` caught this
after #764 merged. The fix is a union — the Zod schema now
accepts either the function or the new `conditionExprSchema`
(which mirrors the type's union: `equals` / `notEquals` /
`in` / `notIn` / `exists` / `all` / `any` recursively). The
runtime evaluator is the single source of truth for shape
correctness; the schema is permissive (`z.unknown()` for
operand values) so future operator additions don't force a
schema bump.

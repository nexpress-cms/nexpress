---
"@nexpress/core": patch
---

Runtime + dev dependency bumps batched from Dependabot's open queue (PRs #818-#827 minus #826). All deps in published packages move under semver patch/minor; no public-API surface change.

- `@nexpress/core`: `@aws-sdk/client-s3` 3.840.0 → 3.1049.0, `jose` 6.2.2 → 6.2.3, `pg` 8.20.0 → 8.21.0
- `@nexpress/admin`: `react-hook-form` 7.72.1 → 7.76.0
- `@nexpress/cli`: `ts-morph` 25.0.1 → 28.0.0 (major; the only direct API surface we use — `Project`, `SyntaxKind`, `SourceFile`, `CallExpression`, `ObjectLiteralExpression`, `ArrayLiteralExpression`, `Node` — is stable across 25 → 28 per the upstream changelog)
- Dev-only (no consumer surface): root `typescript-eslint` 8.59.3 → 8.59.4; `apps/web` `@playwright/test` 1.59.1 → 1.60.0, `tailwindcss` + `@tailwindcss/postcss` 4.2.2 → 4.3.0; `pg` devDep alignment to 8.21.0 in `@nexpress/app` + `create-nexpress` (matches `@nexpress/core`'s runtime range).

Held back from this batch: `undici` 6.25.0 → 8.3.0 (#826). The bump triggers a typecheck failure in `packages/wp-import/src/media/download.ts` because Node's bundled fetch types resolve `Dispatcher` against `undici-types@6.21.0` (Node 22's vendored undici), and an explicit `undici@8` dep introduces a cross-version `DispatchOptions` mismatch. Needs a small refactor in wp-import to be safe; deferred to a follow-up.

`pnpm verify` (build + typecheck + test across all 79 turbo tasks) green locally with the 9 included bumps.

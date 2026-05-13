---
"create-nexpress": patch
"@nexpress/web": patch
---

Fix the missing `max-w-[420px]` / `max-w-[380px]` wrap on `/admin/setup` (and every other AuthCard page) by closing two gaps in the Tailwind v4 source pipeline:

1. **Add `packages/app/src` to `@source`** so the scanner sees `setup-client.tsx` and the other admin/site pages that moved into `@nexpress/app` after PR #704. Scaffolds get the equivalent `node_modules/@nexpress/app/src/**/*.{ts,tsx}` (via `snapshot-rewrites.ts`'s new `app` branch — admin/blocks/editor stay on `dist/**/*.js` because they ship bundled, `@nexpress/app` ships its raw `.tsx` source per its `./admin/*` export map).

2. **`@source inline()` for AuthCard's bracketed utilities.** Verified that Tailwind v4's scanner drops arbitrary-value classes (`max-w-[380px]`, `shadow-[…]`, `bg-[radial-gradient(…)]`) when they live inside a long multi-utility string — same source file's standard `min-h-screen` is picked up fine. Force the AuthLayout/AuthCard utilities into the stylesheet with explicit `@source inline()` lines so the layout doesn't depend on scanner heuristics.

Verified with a clean `pnpm --filter @nexpress/web build`: `380px` and `420px` now appear in the generated CSS (previously 0).

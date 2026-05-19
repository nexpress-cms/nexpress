---
"@nexpress/wp-import": patch
---

Bumps `undici` from `^6.25.0` to `^8.3.0` (the bump deferred from #831's batch). Only direct surface we use is `new Agent({ connect })` for the DNS-pinned dispatcher in `media/download.ts`, which is unchanged across the 6 → 8 boundary.

The bump exposes a TypeScript-only cross-version mismatch: Node 22's bundled `fetch` types resolve `Dispatcher` against `undici-types@6.x` (vendored), while our explicit `undici@8` dep makes our `Agent` import the 8.x variant. The two `Dispatcher` shapes are structurally identical at runtime but TS reports them as nominally distinct. Fixed by casting the dispatcher assignment through `unknown` at the fetch boundary — the option is pass-through to Node's fetch and we never read it back, so erasing the type at the assignment site is safe.

No runtime behavior change for consumers; `pnpm verify` green across all 79 turbo tasks.

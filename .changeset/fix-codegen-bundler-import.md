---
"@nexpress/core": patch
"@nexpress/web": patch
---

fix(core, web): drop `.js` extension from generated `documents.ts` import — unbreaks Next 16 Turbopack build

`packages/core/src/db/type-generator.ts` emitted `import { … } from "./collections.js"` into the generated `documents.ts`. That works under NodeNext module resolution (which `tsc --noEmit` uses) but breaks Next 16's Turbopack build, which respects `apps/web/tsconfig.json`'s `moduleResolution: "Bundler"` — Bundler resolution doesn't rewrite `.js` → `.ts` for relative imports the way NodeNext does.

The two layers diverged silently: `pnpm typecheck` (58/58) kept passing because tsc handled the rewrite; `pnpm build` failed at `next build` with `Module not found: Can't resolve './collections.js'`.

Fix: drop the `.js` extension in the generator's emit. Extension-less imports work under both resolution strategies — Bundler resolves directly to the `.ts` file, NodeNext does the same when the extension is omitted in TS source.

Also updated the existing `apps/web/src/db/generated/documents.ts` to match (don't wait for the next `pnpm db:generate` to land it).

361 core unit tests pass. `pnpm build` now succeeds (31/31 tasks). Plugged a real-world testing gap — typecheck and build had silently diverged on this rule for some time. Adding `pnpm build` to the per-track verification routine going forward.

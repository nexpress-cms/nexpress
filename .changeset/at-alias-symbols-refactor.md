---
"@nexpress/app": patch
"@nexpress/next": patch
---

Moves the SYMBOL source for `@nexpress/app/lib/*`'s bootstrap helpers (`getDb`, `nexpressConfig`, `ensureCoreServices`, `ensurePluginsLoaded`, `ensureJobProducer`, `reloadPlugins`) from the consumer's tsconfig-aliased `@/lib/bootstrap` to a new set of module-level accessors on `@nexpress/next`. `createBootstrap(...)` now registers the returned handles + resolved config on `@nexpress/next`'s module state in addition to returning them; the accessors read from that state.

The side-effect import `import "@/lib/bootstrap"` is preserved at the top of each `@nexpress/app/lib/*` file that needs the consumer's bootstrap loaded — in Next's bundler context this still resolves through the consumer's `@/* → ./src/*` alias to the project's `src/lib/bootstrap.ts`, whose `createBootstrap(...)` call populates the accessor state. Same trigger mechanism, just the symbols flow through a package-resolvable name now.

Why: `@nexpress/app`'s compiled dist previously contained `import { getDb, ... } from "@/lib/bootstrap"` symbol imports that `tsx` couldn't resolve when the importing JS lived in `node_modules` (the bug class that broke `pnpm seed:content` / `pnpm worker` for scaffolded sites until #834 routed those scripts around lib/init-core). After this refactor the dist's symbol references all resolve to `@nexpress/next` — a real npm package — so any future tsx-script consumer of bootstrap symbols can pull them straight from `@nexpress/next` without re-inventing the wiring inline. The lingering `import "@/lib/bootstrap"` side-effect imports stay dormant in tsx contexts (scripts bypass `@nexpress/app/lib/*` per the #834 pattern; CI's scaffold-smoke step in #836 catches accidental regressions).

No consumer-visible API change. The scaffold's `src/lib/bootstrap.ts` keeps its existing shape (re-exports the handles `createBootstrap()` returned). New code can import directly from `@nexpress/next` if preferred.

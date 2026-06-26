# Removing the `@/lib/bootstrap` consumer alias from `@nexpress/app`

**Status**: Design / deferred. Two implementation attempts (2026-05-19 in-session revert, 2026-05-20 PR #838 closed) both walked back as net-loss trades. Don't attempt another half-measure without working through this doc end-to-end first.

**Owners**: Whoever picks this up next. Start here, not at code.

## The problem

`@nexpress/app`'s source files in `src/lib/{init-core,db,auth-helpers,auth-routes,member-auth-helpers}.ts` and `src/api/admin/plugins/reload/route.ts` reference the consumer's `@/lib/bootstrap` via tsconfig path alias. That import does two things at once:

1. **Symbol resolution** — pulls `getDb`, `nexpressConfig`, `ensureCoreServices`, `ensurePluginsLoaded`, `ensureJobProducer`, `reloadPlugins` from the consumer's `src/lib/bootstrap.ts`.
2. **Side-effect timing** — the act of importing the consumer's bootstrap module runs its top-level `createBootstrap(...)` call, which wires DB / storage / plugin singletons before any downstream code reads them.

Each consumer (apps/web, every scaffolded project) supplies its own `src/lib/bootstrap.ts` and a tsconfig with `paths: { "@/*": ["./src/*"] }`.

### Why it works in Next routes

Next's bundler reads the consumer's tsconfig when it compiles `@nexpress/app`'s source files (via `transpilePackages: ["@nexpress/app", ...]`). `@/lib/bootstrap` resolves to the consumer's file. The bundler inlines bootstrap.ts into the same chunk as the importing file, so symbol resolution AND the side-effect call land at consumer module-eval time.

### Why it breaks under `tsx`

`tsx` (the runtime used by every scaffolded `pnpm <script>` command) applies tsconfig.paths to **TypeScript files inside the consumer's source tree**, not to `.js` files inside `node_modules`. `@nexpress/app`'s compiled dist (`dist/lib/init-core.js` etc.) carries the literal `@/lib/bootstrap` import string. When tsx loads that .js, Node's default resolver parses `@/lib` as a scoped package name, looks it up in `node_modules`, fails, and exits with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/lib'
  imported from .../node_modules/@nexpress/app/dist/lib/init-core.js
```

This bit a scaffolded site's `pnpm run seed:content` in #834. Two tsx scripts (seed-content, worker) used to transit through `@nexpress/app/lib/init-core` and broke at module load.

## What's in place today (mitigation, not fix)

Four guard layers, each one trades architectural coherence for staying-ahead-of-the-bug-class:

- **#834 — bypass** (`scaffold templates`): the two tsx scripts that hit the
  bug (`seed-content.ts`, `worker.ts`) now bootstrap via `createBootstrap`
  from `@nexpress/next` directly, importing `seedAll` / `runWorker` from
  packages that have no `@/` references in their compiled output. They never
  touch `@nexpress/app/lib/init-core`.
- **#836 — smoke** (`.github/workflows/ci.yml` scaffold-smoke job): after
  scaffolding a fresh project, runs each tsx script against a closed-port DB
  and greps stderr for `ERR_MODULE_NOT_FOUND`,
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and `Cannot find package/module`. Fails
  the build on any match. Catches accidental new transits through the broken
  chain.
- **#837 — spawn tests** (`apps/web/tests/setup-server-spawn.unit.test.ts`):
  spawns the setup wizard in each of its three modes (HTTP / CLI /
  non-interactive), asserts the binary doesn't crash with a module-resolution
  error before reaching its DB-connect step. Catches setup-wizard-specific
  regressions.
- **#1107 — app script smoke** (`.github/scripts/check-web-script-runtime.mjs`
  in the CI checks job): runs the reference app's `apps/web/scripts/*.ts`
  entrypoints through `tsx` after `pnpm build`, with closed-port DB/env
  values, and fails on the same resolver-crash signatures. Catches source-side
  script regressions before they reach the scaffold/publish path.

Net: the bug class is closed for every known consumer. The **debt** is "future tsx-script consumers that genuinely need to use `@nexpress/app/lib/*` symbols would still break, and they'd be the ones to surface the constraint."

## Failed attempts

### Attempt v1 — 2026-05-19 (reverted before PR)

Tried to remove BOTH the symbol imports AND the side-effect imports of `@/lib/bootstrap`. Moved symbol exports to module-level accessors on `@nexpress/next` (a `Proxy` for `nexpressConfig`, plain functions for the rest). Introduced `apps/web/src/instrumentation.ts` to eager-load the consumer's bootstrap module at Next server startup.

What blocked it:

- **Instrumentation bundling**: `instrumentation.ts` → `import("./lib/bootstrap")` → transitively loads `@nexpress/core` → which references `@node-rs/argon2-wasm32-wasi` (a platform-specific optional dep). Turbopack's instrumentation bundle didn't seem to honor `serverExternalPackages` the way the main app bundle does, and the wasm32-wasi resolution failed at build time. The obvious next thing to try — adding the wasm sub-dep explicitly to `serverExternalPackages` (or using a different config knob like `bundlePagesRouterDependencies`) — wasn't attempted in the v1 session. That's the first thing to verify if instrumentation comes back on the table.
- **Route path graph**: removing the `@/`-aliased side-effect imports from `@nexpress/app/lib/*` meant nothing in the route's static import chain pulled the consumer's bootstrap. Routes go through `@nexpress/app/api/.../route.ts` (raw source via the `./api/*` exports map), which imports `./init-core` relatively — bypassing the consumer's wrapper init-core. To re-establish the trigger, every one of the ~131 `api/*` source files would need its relative `init-core` import rewritten to `@/lib/init-core` (consumer-aliased, routing through the wrapper). Too invasive for one PR.

Reverted to a clean tree before the changes ever hit a PR.

### Attempt v2 — PR #838 (2026-05-20, closed)

Narrower scope: keep the `import "@/lib/bootstrap"` SIDE-EFFECT imports in place, only move the SYMBOL imports to `@nexpress/next` accessors. The Next trigger mechanism stays exactly as before; only the symbol source changes.

What was added to `@nexpress/next`:

- Module-level `_activeBootstrap` + `_activeConfig` state, set by `createBootstrap` when it runs.
- `getDb` / `ensureCoreServices` / `ensurePluginsLoaded` / `ensureJobProducer` / `reloadPlugins` as plain accessor functions that throw a clear "bootstrap not registered" error if called before the consumer's `createBootstrap` runs.
- `nexpressConfig` as a `Proxy` over the registered config — preserves the `nexpressConfig.site.name` access pattern at the 5+ call sites.

Why the trade walked back:

| Cost                                 | Detail                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module-level mutable state           | Anti-pattern. Last-write-wins semantics. Test isolation needs explicit reset.                                                                                                |
| Proxy identity                       | `nexpressConfig === actualConfig` returns false. `JSON.stringify` edge cases. Stepping through the debugger goes through trap frames.                                        |
| Cross-package coupling               | `@nexpress/next` accessors are silently coupled to `@nexpress/app/lib/*` having run their side-effect imports. Reading the code, the dependency is implicit.                 |
| **The actual bug class stayed open** | The side-effect imports `import "@/lib/bootstrap"` are still in the compiled dist. A tsx-script consumer that hits `@nexpress/app/lib/*` would crash the same way as before. |

Net: ~130 lines of accessor + Proxy boilerplate added across @nexpress/next and @nexpress/app (PR #838: 168 insertions / 39 deletions), all for a cosmetic improvement in where symbols come from. The original bug class is unchanged. ROI negative.

## What a real fix looks like

The work splits naturally into three concerns, all of which must land for the alias to go away:

### 1. Decide on a single bootstrap trigger contract

Pick one mechanism and document it. Candidates:

- **Next instrumentation (`src/instrumentation.ts`)** — official. Runs once at server startup before any route. Blocked in v1 by transitive native-dep resolution; needs a deeper look at why `serverExternalPackages` doesn't propagate to the instrumentation bundle, or whether `bundlePagesRouterDependencies` / a specific config override unblocks it.
- **Root layout (`src/app/layout.tsx`)** — server component that runs for every page render. Doesn't run for API routes that don't share the layout, so doesn't cover all entry points.
- **Per-route side-effect import** — each `@nexpress/app/api/*` source file imports `@/lib/init-core` (the consumer's wrapper, not relative). That makes the wrapper the single chokepoint; its `import "./bootstrap.js"` side-effect fires for every route. Requires rewriting ~131 files but the change is mechanical.
- **Explicit hook in `nexpress.config.ts`** — change the config file's shape so it self-registers. Couples config to code; arguably bad layering.

The per-route side-effect import (option 3) is the most boring and most likely to actually work. Instrumentation (option 1) is the cleanest if the native-dep block is solvable.

### 2. Restructure `@nexpress/app/package.json` exports for `./lib/*`

Today's exports map:

```json
"./lib/*": {
  "types": "./dist/lib/*.d.ts",
  "import": "./dist/lib/*.js",
  "default": "./dist/lib/*.js"
}
```

Pointing this to `./src/lib/*.ts` instead would let Next bundle the lib/ source with consumer tsconfig.paths in scope. Tsx consumers don't import lib/\* anyway (per the #834 bypass pattern), so source-only is safe.

Caveat: anything that DOES bundle `@nexpress/app/lib/*` outside Next's transpilePackages chain (e.g., a future tsup-built consumer integration) would now compile TS source. That's usually fine, but verify no consumer relies on the dist .js files being on disk.

### 3. Migration plan

- Existing scaffolds need their `src/lib/init-core.ts` wrapper to keep working through the transition. The wrapper today is `export * from "@nexpress/app/lib/init-core";`. After the refactor, it stays the same — re-exports from the new source-resolved entry. No breaking change for consumers.
- The `_consumer-stubs/lib/bootstrap.ts` typecheck stub is no longer needed when `@nexpress/app/src/lib/*` stops referencing `@/lib/bootstrap`. Remove it.
- A changeset that flips the exports map needs a major version bump on `@nexpress/app` if the dist .js files were ever a documented contract surface. Today they aren't (the wrapper pattern is the contract), so a patch under pre-1.0 conventions should be fine — but verify by grepping the docs for direct references to `dist/lib/*`.

## Don't re-attempt without

- A working answer to the instrumentation native-dep block (or commitment to option 3's per-route-import sweep).
- A repro of what BREAKS today for a real consumer. The current mitigation is fine; doing this for cleanliness alone is risky for marginal gain.
- A test that catches the next regression class. Today's scaffold and apps/web
  script smokes check `ERR_MODULE_NOT_FOUND`-style resolver crashes — they
  should keep working through the refactor and prove the new contract holds.

## References

- [#834 — `fix(cli): scaffold compose port fallback + seed-content tsx chain`](https://github.com/nexpress-cms/nexpress/pull/834)
- [#836 — `chore(ci, release, docs): scaffold runtime smoke + publish race guard + troubleshooting`](https://github.com/nexpress-cms/nexpress/pull/836)
- [#837 — `test(web): spawn-based end-to-end coverage for setup-server.ts`](https://github.com/nexpress-cms/nexpress/pull/837)
- [#838 — `refactor(app, next): move bootstrap SYMBOLS to @nexpress/next accessors`](https://github.com/nexpress-cms/nexpress/pull/838) (closed)

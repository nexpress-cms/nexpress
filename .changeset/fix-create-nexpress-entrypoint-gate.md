---
"create-nexpress": patch
---

**Fix `pnpm test` failure caused by `main()` running at import time.**

`packages/cli/src/index.ts` invoked `main()` as a top-level
expression. Importing the module from a test (e.g. `cli-args.test.ts`
imports `parseCliArgs` from `./index.js`) triggered `main()`,
which called `promptForProjectConfig` in a non-TTY env, threw,
and hit the catch's `process.exit(1)` — vitest surfaced that as
an unhandled rejection that failed the entire test suite. The
failure had been present on `main` long enough that `pnpm test`
hadn't been green at the repo level for a while.

Fix: gate the `main()` call on an `isCliEntryPoint()` check
(`import.meta.url` realpath-matched to `process.argv[1]`).
Behaves like `require.main === module` for ESM. The CLI still
runs `main()` when invoked directly (`pnpm create nexpress …`);
test imports of `parseCliArgs` no longer kick off the prompt
flow.

After this, `pnpm test` is green across all 43 workspace test
tasks for the first time since the regression landed.

import { runCli } from "@nexpress/wp-import";

/**
 * Phase 21.3 — `pnpm wp-import` shim. Thin by design: the CLI
 * logic lives in `@nexpress/wp-import`. The shim's only job is to
 * forward argv and apply the resulting exit code.
 *
 * No core-services bootstrap yet — Phase 21.3 is dry-run only.
 * When the applier lands in 21.4 this file is where we'll plumb
 * `ensureCoreServices()` through to the CLI before delegating.
 */
const code = await runCli(process.argv.slice(2));
process.exit(code);

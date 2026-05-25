import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";

/**
 * Side-effect module that loads `.env` files before any other
 * import in a seed/CLI script can evaluate.
 *
 * The reason this is its own file: ESM imports are evaluated in
 * topological order, so the first import declaration in a script
 * runs to completion before subsequent imports' module bodies are
 * evaluated. Putting the dotenv calls inside the script itself
 * doesn't help — the script's own `import` statements have
 * already evaluated by the time the script's first statement
 * runs, and `nexpress.config.ts` (transitively imported by
 * `init-core`) reads `process.env.NP_SECRET` at module-load time.
 *
 * Resolution order:
 *   1. If `NP_ROOT_ENV_PATH` is set (apps/web's case in the
 *      monorepo — points at `../../.env`), load that first.
 *      It wins on conflicts.
 *   2. Then load `<cwd>/.env`, which fills any gaps without
 *      overriding. For scaffolded projects `NP_ROOT_ENV_PATH`
 *      is unset, so this is the only file consulted.
 *
 * `process.cwd()` is the anchor — that's the directory `pnpm`
 * launches the script from, which is the project root for both
 * apps/web and scaffolds.
 *
 * Import this file FIRST in any script that depends on
 * `nexpress.config.ts` evaluating cleanly:
 *
 *   import "@nexpress/app/scripts/_load-env";
 */
const projectRoot = process.cwd();

const ancestor = process.env.NP_ROOT_ENV_PATH;
if (ancestor) {
  loadEnv({ path: resolve(projectRoot, ancestor), quiet: true });
}

loadEnv({ path: resolve(projectRoot, ".env"), override: false, quiet: true });

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
 * `init-core`) reads `process.env.NX_SECRET` at module-load time.
 *
 * Resolution order matches the original inline calls:
 *   1. `<repo>/.env` (root) — primary source of truth
 *   2. `<repo>/apps/web/.env` (local) — fills gaps without overriding
 *
 * Import this file FIRST in any script that depends on
 * `nexpress.config.ts` evaluating cleanly:
 *
 *   import "./_load-env.js"; // must be the first import
 *   import { ensureCoreServices } from "../src/lib/init-core";
 */
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env"), override: false });

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

/**
 * Side-effect module that loads `.env` before any other import in a
 * CLI script (doctor / seed) can evaluate.
 *
 * The reason this is its own file: ESM imports are evaluated in
 * topological order, so the first import declaration in a script
 * runs to completion before subsequent imports' module bodies are
 * evaluated. Putting the dotenv call inside the script itself
 * doesn't help — by the time the script's first statement runs,
 * its own `import` lines have already evaluated, and
 * `nexpress.config.ts` (transitively imported by `init-core`) reads
 * `process.env.NP_SECRET` at module-load time and Zod-validates the
 * result.
 *
 * Import this file FIRST in any script that depends on
 * `nexpress.config.ts` evaluating cleanly:
 *
 *   import "./_load-env.js"; // must be the first import
 *   import { startWorker } from "@nexpress/core";
 */
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

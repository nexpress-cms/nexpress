import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";

/**
 * Side-effect module that loads `.env` files before any other
 * import in a seed/CLI script can evaluate.
 *
 * We inline the dotenv calls here (instead of re-exporting
 * `@nexpress/app/scripts/_load-env`) for one reason: ESM's
 * top-level-await rule evaluates *sibling* imports of the same
 * parent module in parallel. A wrapper that did `await
 * import("@nexpress/app/scripts/_load-env")` wouldn't block
 * `nexpress.config.ts` from evaluating concurrently — config
 * validation would race the env load.
 *
 * Apps/web's `.env` is the monorepo's root file. The local
 * `apps/web/.env` is the secondary, gap-filling source.
 */
const projectRoot = process.cwd();
loadEnv({ path: resolve(projectRoot, "../../.env") });
loadEnv({ path: resolve(projectRoot, ".env"), override: false });

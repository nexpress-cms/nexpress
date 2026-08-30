import "./_load-env.js";

import { generateMigrations } from "./generate-migrations-core.js";

void generateMigrations().catch((error: unknown) => {
  process.stderr.write(
    `Migration generation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

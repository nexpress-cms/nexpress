import { type NpAuthUser } from "@nexpress/core";
import { runCli } from "@nexpress/xliff";

import "./_load-env.js";
import { shutdownBootstrap } from "../src/lib/bootstrap.js";
import { ensureFor } from "../src/lib/init-core.js";

async function shutdownAndExit(code: number): Promise<never> {
  let exitCode = code;
  try {
    await shutdownBootstrap();
  } catch (error) {
    process.stderr.write(`xliff: bootstrap shutdown failed: ${String(error)}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

/**
 * Phase 12.12 — `pnpm xliff` shim. Boots core services + plugins
 * and forwards argv to `@nexpress/xliff`'s CLI. Operators run:
 *
 *   pnpm xliff export ./xliff/                  # write per-locale-pair files
 *   pnpm xliff import ./xliff/posts-en-ko.xliff # apply translator's bundle
 *   pnpm xliff import ./… --dry-run             # validate + report only
 *
 * The CLI does not authenticate against a real user — writes are
 * recorded under a synthetic `xliff-import` actor with `admin`
 * role so the audit trail surfaces "this was a bulk import" vs
 * an interactive admin edit.
 */
async function main(): Promise<void> {
  await ensureFor("plugins");

  const importerUser: NpAuthUser = {
    id: "00000000-0000-0000-0000-000000000000",
    email: "xliff-import@local",
    name: "XLIFF importer",
    role: "admin",
    tokenVersion: 0,
  };

  const io = {
    out(message: string): void {
      process.stdout.write(message);
    },
    err(message: string): void {
      process.stderr.write(message);
    },
  };

  const result = await runCli(io, process.argv.slice(2), { user: importerUser });
  await shutdownAndExit(result.exitCode);
}

void main().catch(async (error) => {
  process.stderr.write(`xliff: ${(error as Error).stack ?? String(error)}\n`);
  await shutdownAndExit(1);
});

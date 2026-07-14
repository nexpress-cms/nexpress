import { type NpAuthUser } from "@nexpress/core";
import { runCli } from "@nexpress/gettext";

import "./_load-env.js";
import { shutdownBootstrap } from "../src/lib/bootstrap.js";
import { ensureFor } from "../src/lib/init-core.js";

async function shutdownAndExit(code: number): Promise<never> {
  let exitCode = code;
  try {
    await shutdownBootstrap();
  } catch (error) {
    process.stderr.write(`gettext: bootstrap shutdown failed: ${String(error)}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

/** Boots the app registries before delegating to the Gettext PO CLI. */
async function main(): Promise<void> {
  await ensureFor("plugins");

  const importerUser: NpAuthUser = {
    id: "00000000-0000-0000-0000-000000000000",
    email: "gettext-import@local",
    name: "Gettext importer",
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
  process.stderr.write(`gettext: ${(error as Error).stack ?? String(error)}\n`);
  await shutdownAndExit(1);
});

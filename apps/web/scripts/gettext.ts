import { type NpAuthUser } from "@nexpress/core";
import { runCli } from "@nexpress/gettext";

import "./_load-env.js";
import { ensureFor } from "../src/lib/init-core.js";

/** Boots the app registries before delegating to the Gettext PO CLI. */
async function main(): Promise<void> {
  await ensureFor("read");
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
  process.exit(result.exitCode);
}

main().catch((error) => {
  process.stderr.write(`gettext: ${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});

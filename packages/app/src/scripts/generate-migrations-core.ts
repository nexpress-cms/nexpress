import { spawn } from "node:child_process";

import { npEnsureAgentLifecycleConstraintMigrationV1 } from "./agent-migration-contract.js";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `Migration generator terminated by ${signal}.`
            : `Migration generator exited with status ${(code ?? -1).toString()}.`,
        ),
      );
    });
  });
}

export async function generateMigrations(): Promise<void> {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  await run(pnpm, ["exec", "drizzle-kit", "generate"]);
  const result = await npEnsureAgentLifecycleConstraintMigrationV1({
    createCustomMigration: () =>
      run(pnpm, [
        "exec",
        "drizzle-kit",
        "generate",
        "--custom",
        "--name",
        "agent-r1-lifecycle-constraints",
      ]),
  });
  if (result.state === "created") {
    process.stdout.write(`Created reviewed Agent lifecycle migration: ${result.migrationFile}\n`);
  }
}

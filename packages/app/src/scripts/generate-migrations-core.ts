import { spawn } from "node:child_process";

import {
  npEnsureAgentReferenceMigrationV1,
  npEnsureAgentReferenceMigrationV2,
  npEnsureAgentReferenceMigrationV3,
  npEnsureAgentReferenceMigrationV4,
} from "./agent-reference-migration.js";
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
  for (const inventory of ["r1", "rollback", "runtime"] as const) {
    const result = await npEnsureAgentLifecycleConstraintMigrationV1({
      inventory,
      createCustomMigration: () =>
        run(pnpm, [
          "exec",
          "drizzle-kit",
          "generate",
          "--custom",
          "--name",
          `agent-${inventory}-lifecycle-constraints`,
        ]),
    });
    if (result.state === "created") {
      process.stdout.write(`Created reviewed Agent lifecycle migration: ${result.migrationFile}\n`);
    }
  }
  await npEnsureAgentReferenceMigrationV1({
    createCustomMigration: () =>
      run(pnpm, [
        "exec",
        "drizzle-kit",
        "generate",
        "--custom",
        "--name",
        "agent-source-reference-lifecycle",
      ]),
  });
  await npEnsureAgentReferenceMigrationV2({
    createCustomMigration: () =>
      run(pnpm, [
        "exec",
        "drizzle-kit",
        "generate",
        "--custom",
        "--name",
        "agent-studio-source-reference-lifecycle",
      ]),
  });
  await npEnsureAgentReferenceMigrationV3({
    createCustomMigration: () =>
      run(pnpm, [
        "exec",
        "drizzle-kit",
        "generate",
        "--custom",
        "--name",
        "agent-cancelled-changeset-source-reference-lifecycle",
      ]),
  });
  await npEnsureAgentReferenceMigrationV4({
    createCustomMigration: () =>
      run(pnpm, [
        "exec",
        "drizzle-kit",
        "generate",
        "--custom",
        "--name",
        "agent-validated-changeset-source-reference-lifecycle",
      ]),
  });
}

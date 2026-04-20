import pc from "picocolors";

import { promptForProjectConfig } from "./prompts.js";
import { scaffoldProject } from "./scaffold.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const localMode = args.includes("--local");
  const initialProjectName = args.find((arg) => !arg.startsWith("--"));
  const config = await promptForProjectConfig(initialProjectName);

  await scaffoldProject({ ...config, localMode });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  console.error(pc.red(`Error: ${message}`));
  process.exit(1);
});

import pc from "picocolors";

import { promptForProjectConfig } from "./prompts.js";
import { scaffoldProject } from "./scaffold.js";

async function main(): Promise<void> {
  const initialProjectName = process.argv.slice(2)[0];
  const config = await promptForProjectConfig(initialProjectName);

  await scaffoldProject(config);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  console.error(pc.red(`Error: ${message}`));
  process.exit(1);
});

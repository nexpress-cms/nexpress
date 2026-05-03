import pc from "picocolors";

import { promptForProjectConfig, type CliFlags } from "./prompts.js";
import { scaffoldProject } from "./scaffold.js";

interface ParsedArgs {
  flags: CliFlags;
  localMode: boolean;
  showHelp: boolean;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const flags: CliFlags = {};
  let localMode = false;
  let showHelp = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
    } else if (arg === "--local") {
      localMode = true;
    } else if (arg === "--example") {
      flags.includeExampleContent = true;
    } else if (arg === "--no-example") {
      flags.includeExampleContent = false;
    } else if (arg === "--docker") {
      flags.dockerSetup = true;
    } else if (arg === "--no-docker") {
      flags.dockerSetup = false;
    } else if (arg.startsWith("--")) {
      // Unknown flag — prefer a hard error over silently scaffolding
      // with the default. The operator probably meant to set
      // something specific.
      throw new Error(`Unknown flag: ${arg}`);
    } else if (flags.projectName === undefined) {
      flags.projectName = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  return { flags, localMode, showHelp };
}

const HELP = `
create-nexpress — scaffold a NexPress project.

Usage:
  pnpm create nexpress [name] [flags]

Positional:
  name                 project directory name (default: my-nexpress-site)

Flags:
  --yes, -y            skip prompts; use defaults (also implied when stdin is not a TTY)
  --example            include sample collections
  --no-example         skip sample collections
  --docker             include docker/docker-compose.yml + Dockerfile
  --no-docker          skip docker artifacts
  --local              use workspace:* deps (only inside the NexPress monorepo)
  -h, --help           show this help

Examples:
  pnpm create nexpress my-site
  pnpm create nexpress my-site --yes --no-example
  pnpm create nexpress my-site --no-docker --no-example --yes
`;

async function main(): Promise<void> {
  const { flags, localMode, showHelp } = parseCliArgs(process.argv.slice(2));
  if (showHelp) {
    console.log(HELP.trim());
    return;
  }
  const config = await promptForProjectConfig(flags);
  await scaffoldProject({ ...config, localMode });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  console.error(pc.red(`Error: ${message}`));
  process.exit(1);
});

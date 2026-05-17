import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import pc from "picocolors";

import { promptForProjectConfig, resolveStarter, type CliFlags } from "./prompts.js";
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

  // Two-pass walk so `--theme` can consume the next argv entry as
  // its value without complicating the main loop. Same trick we'd
  // use for any future `--<key> <value>` flag.
  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift()!;
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
    } else if (arg === "--theme") {
      // `--theme <id>` and the friendlier alias `--starter <id>` both
      // store the picked theme id on the flag bag. The built-in id
      // check happens inside `promptForProjectConfig` so the same
      // gate covers space-form, `=`-form, and the alias. If both
      // flags are passed, last-wins (standard CLI convention).
      const value = args.shift();
      if (!value || value.startsWith("--")) {
        throw new Error("--theme requires a value (e.g. --theme magazine).");
      }
      flags.themeId = value;
    } else if (arg.startsWith("--theme=")) {
      flags.themeId = arg.slice("--theme=".length);
    } else if (arg === "--starter") {
      const value = args.shift();
      if (!value || value.startsWith("--")) {
        throw new Error("--starter requires a value (e.g. --starter blog).");
      }
      flags.themeId = resolveStarter(value);
    } else if (arg.startsWith("--starter=")) {
      flags.themeId = resolveStarter(arg.slice("--starter=".length));
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
  --starter <id>       pick a starter (blog | magazine | portfolio | docs);
                       sets the active theme at first boot, skipping the
                       interactive starter prompt
  --theme <id>         same as --starter but takes raw theme ids
                       (default | magazine | portfolio | docs); kept for
                       back-compat — prefer --starter for new scripts
  --local              use workspace:* deps (only inside the NexPress monorepo)
  -h, --help           show this help

Starter picking normally happens interactively at scaffold time, or
later in the first-boot admin setup wizard at /admin/setup (browser).
All four built-in starters are bundled into every scaffold regardless;
the flag / prompt just decides which one is active on first boot. The
chosen id is written to .env as NP_ADMIN_THEME=<id>, which the wizard
reads as the picker's initial selection.

Examples:
  pnpm create nexpress my-site
  pnpm create nexpress my-site --starter docs
  pnpm create nexpress my-site --yes --no-example
  pnpm create nexpress my-site --no-docker --no-example --yes
  pnpm create nexpress my-site --starter magazine --yes
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

/**
 * Run `main()` only when the file is the process entry point.
 *
 * Without this gate, `vitest` (or any other importer of
 * `parseCliArgs`) triggered `main()` at module-load time, hit a
 * non-TTY prompt, and called `process.exit(1)` — which vitest
 * surfaces as an unhandled rejection that fails the entire test
 * suite. The Node-ESM equivalent of `require.main === module`:
 * compare `import.meta.url` (this module's resolved URL) with the
 * URL form of `process.argv[1]` (the entry point Node was invoked
 * with). `realpathSync` normalizes both sides so symlinks
 * (`pnpm`'s shimmed `.bin/create-nexpress` → `dist/index.js`)
 * still match.
 */
function isCliEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return realpathSync(thisFile) === realpathSync(process.argv[1]);
  } catch {
    // Either path failed to resolve — safer to NOT run main().
    return false;
  }
}

if (isCliEntryPoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";

    console.error(pc.red(`Error: ${message}`));
    process.exit(1);
  });
}

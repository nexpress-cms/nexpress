// Must be first so .env is available before we inspect deployment shape.
import "./_load-env.js";

import {
  DEPLOY_TARGETS,
  inferDeployTargetFromEnv,
  parseDeployTargetArg,
} from "./deploy-targets.js";
import {
  buildDeployPlan,
  buildDeployPlanJson,
  renderBriefDeployPlan,
  renderDeployPlan,
} from "./deploy-plan-core.js";

interface CliOptions {
  json: boolean;
  brief: boolean;
  color: boolean;
}

function printHelp(): void {
  console.log(`NexPress deploy plan

Usage:
  pnpm run deploy:plan
  pnpm run deploy:plan -- --target vercel
  pnpm run deploy:plan -- --target vercel --brief --no-color
  pnpm --silent run deploy:plan -- --target vercel --json

Targets:
  ${DEPLOY_TARGETS.join(", ")}

Options:
  --json       Print the stable machine-readable deployment plan.
  --brief      Print unresolved required env plus compact launch and command steps.
  --no-color   Disable ANSI color in human-readable output.
  --dry-run    Accepted for agent workflows; deploy:plan never applies changes.
  --help, -h   Show this help.

Output starts with the target's launch handoff, then env, storage,
runtime, migration, preflight, release, and post-deploy verify steps.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function parseCliOptions(argv: string[]): CliOptions {
  return {
    json: argv.includes("--json"),
    brief: argv.includes("--brief"),
    color: !argv.includes("--no-color") && !process.env.NO_COLOR,
  };
}

try {
  const argv = process.argv.slice(2);
  if (shouldPrintHelp(argv)) {
    printHelp();
    process.exit(0);
  }

  const explicitTarget = parseDeployTargetArg(argv);
  const target = explicitTarget ?? inferDeployTargetFromEnv() ?? "docker";
  const inferred = explicitTarget === null;
  const options = parseCliOptions(argv);
  const plan = buildDeployPlan(target);

  if (options.json) {
    console.log(JSON.stringify(buildDeployPlanJson(plan, inferred, process.env), null, 2));
  } else if (options.brief) {
    console.log(renderBriefDeployPlan(plan, inferred, process.env, { color: options.color }));
  } else {
    console.log(renderDeployPlan(plan, inferred, process.env, { color: options.color }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

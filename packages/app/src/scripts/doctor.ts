// Must be the first import — populates process.env before
// `nexpress.config.ts` evaluates. We deliberately don't import the
// nexpress runtime itself; doctor's job is to diagnose env problems
// that *prevent* boot, so it has to keep running when the boot path
// would crash.
import "./_load-env.js";

import {
  DEPLOY_TARGETS,
  inferDeployTargetFromEnv,
  parseDeployTargetArg,
} from "./deploy-targets.js";
import { collectDoctorChecks } from "./doctor-core.js";
import {
  buildDoctorJson,
  dim,
  renderBriefDoctorReport,
  renderDoctorCheck,
  renderDoctorFixPlan,
  renderDoctorNextCommand,
  renderDoctorSummary,
} from "./doctor-output.js";

const ARGV = process.argv.slice(2);
const PROD_MODE = ARGV.includes("--prod");
const JSON_MODE = ARGV.includes("--json");
const FIX_PLAN_MODE = ARGV.includes("--fix-plan");
const BRIEF_MODE = ARGV.includes("--brief");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress doctor

Usage:
  pnpm run doctor
  pnpm run doctor -- --prod --target vercel
  pnpm run doctor:prod -- --target vercel --brief --no-color
  pnpm run doctor:prod -- --target vercel --fix-plan
  pnpm --silent run doctor:prod -- --target vercel --json --fix-plan

Targets:
  ${DEPLOY_TARGETS.join(", ")}

Options:
  --prod          Run production deploy-readiness checks.
  --target <host> Apply host-specific production checks.
  --json          Print the stable machine-readable readiness report.
  --fix-plan      Include ordered fix suggestions.
  --brief         Print compact one-line-per-check human output.
  --no-color      Disable ANSI color in human-readable output.
  --help, -h      Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }

  const deployTarget = PROD_MODE
    ? (parseDeployTargetArg(ARGV) ?? inferDeployTargetFromEnv())
    : null;
  if (PROD_MODE && !JSON_MODE && !BRIEF_MODE) {
    const targetDetail = deployTarget ? ` for ${deployTarget}` : "";
    console.log(dim(`Running in --prod mode${targetDetail}: deploy-readiness checks.`, COLOR_MODE));
    console.log("");
  }
  const checks = await collectDoctorChecks({
    prodMode: PROD_MODE,
    target: deployTarget,
    env: process.env,
  });
  const report = buildDoctorJson({
    prodMode: PROD_MODE,
    target: deployTarget,
    checks,
    includeFixPlan: FIX_PLAN_MODE,
  });
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else if (BRIEF_MODE) {
    console.log(
      renderBriefDoctorReport(
        {
          prodMode: PROD_MODE,
          target: deployTarget,
          checks,
          nextCommand: FIX_PLAN_MODE ? null : report.nextCommand,
        },
        { color: COLOR_MODE },
      ),
    );
    if (FIX_PLAN_MODE) {
      console.log("");
      console.log(renderDoctorFixPlan(report.fixPlan ?? [], { color: COLOR_MODE }));
    }
  } else {
    for (const result of checks) console.log(renderDoctorCheck(result, { color: COLOR_MODE }));
    console.log("");
    console.log(renderDoctorSummary(checks, { color: COLOR_MODE }));
    if (FIX_PLAN_MODE) {
      console.log("");
      console.log(renderDoctorFixPlan(report.fixPlan ?? [], { color: COLOR_MODE }));
    } else {
      const nextLine = renderDoctorNextCommand(report.nextCommand, { color: COLOR_MODE });
      if (nextLine) console.log(nextLine);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

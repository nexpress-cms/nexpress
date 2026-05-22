// Must be first so .env is available before we inspect deployment shape.
import "./_load-env.js";

import {
  DEPLOY_TARGETS,
  deployTargetTitle,
  inferDeployTargetFromEnv,
  parseDeployTargetArg,
  type DeployTarget,
} from "./deploy-targets.js";

interface TargetPlan {
  target: DeployTarget;
  title: string;
  fit: string[];
  requiredEnv: string[];
  recommendedEnv: string[];
  storage: string[];
  runtime: string[];
  commands: string[];
}

const COLOR = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

function printHelp(): void {
  console.log(`NexPress deploy plan

Usage:
  pnpm run deploy:plan
  pnpm run deploy:plan -- --target vercel

Targets:
  ${DEPLOY_TARGETS.join(", ")}
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function planFor(target: DeployTarget): TargetPlan {
  const commonRequired = ["DATABASE_URL", "NP_SECRET", "SITE_URL"];
  const commonRecommended = ["NP_ENABLE_JOBS=1", "NP_SCHEDULER_TOKEN"];
  const commonCommands = [
    "pnpm install",
    "pnpm run setup -- --non-interactive",
    "pnpm db:migrate",
    `pnpm run doctor:prod -- --target ${target}`,
  ];

  switch (target) {
    case "vercel":
      return {
        target,
        title: deployTargetTitle(target),
        fit: [
          "Fastest hosted app path for a scaffolded Next.js site.",
          "Best when media is stored in S3/R2 and scheduled publishing uses vercel.json cron.",
        ],
        requiredEnv: [...commonRequired, "NP_STORAGE_ADAPTER=s3", "NP_S3_BUCKET", "NP_S3_REGION"],
        recommendedEnv: commonRecommended,
        storage: [
          "Use S3-compatible storage. Vercel's filesystem is ephemeral between deployments.",
          "Set NP_S3_ENDPOINT when using R2, MinIO, or another non-AWS S3 provider.",
        ],
        runtime: [
          "Import the project in Vercel after pushing the repo.",
          "vercel.json already includes the scheduled-publish cron endpoint.",
          "Use a separate worker host if you need long-running pg-boss workers.",
        ],
        commands: commonCommands,
      };
    case "railway":
      return {
        target,
        title: deployTargetTitle(target),
        fit: [
          "Good Docker deploy path with managed Postgres.",
          "Best when web and worker run as separate services from the same image.",
        ],
        requiredEnv: commonRequired,
        recommendedEnv: [...commonRecommended, "NP_STORAGE_ADAPTER=s3"],
        storage: [
          "Prefer S3-compatible storage for durable media.",
          "Local storage is acceptable only for a single persistent-volume deployment.",
        ],
        runtime: [
          "Create one web service for `pnpm start`.",
          "Create one worker service for `pnpm worker` when NP_ENABLE_JOBS=1.",
          "Run migrations before promoting the new image.",
        ],
        commands: commonCommands,
      };
    case "render":
      return {
        target,
        title: deployTargetTitle(target),
        fit: [
          "Good Docker deploy path with managed Postgres.",
          "Best when a background worker service is allowed to run beside the web service.",
        ],
        requiredEnv: commonRequired,
        recommendedEnv: [...commonRecommended, "NP_STORAGE_ADAPTER=s3"],
        storage: [
          "Prefer S3-compatible storage for durable media.",
          "Local storage is acceptable only if you deliberately attach persistent disk to one node.",
        ],
        runtime: [
          "Create a web service for the Docker image.",
          "Create a background worker for `pnpm worker` when NP_ENABLE_JOBS=1.",
          "Run migrations before the web service receives traffic.",
        ],
        commands: commonCommands,
      };
    case "fly":
      return {
        target,
        title: deployTargetTitle(target),
        fit: [
          "Good Docker self-hosting path when you want control over machines and regions.",
          "Works with local storage only for a single-machine deployment with attached volume.",
        ],
        requiredEnv: commonRequired,
        recommendedEnv: commonRecommended,
        storage: [
          "Use S3-compatible storage for multi-machine or multi-region deploys.",
          "If using local storage, attach a volume and set NP_MULTI_NODE=false.",
        ],
        runtime: [
          "Run the web process from the Docker image.",
          "Run a separate worker process or machine for `pnpm worker` when jobs are enabled.",
          "Run migrations as a release step before promotion.",
        ],
        commands: commonCommands,
      };
    case "docker":
      return {
        target,
        title: "Docker self-host",
        fit: [
          "Best when you own the host, reverse proxy, Postgres, and storage policy.",
          "The simplest single-node path can use local media storage.",
        ],
        requiredEnv: commonRequired,
        recommendedEnv: commonRecommended,
        storage: [
          "Local storage is fine for one node with backed-up persistent disk.",
          "Use S3-compatible storage before adding more app nodes.",
        ],
        runtime: [
          "Run one web container for `pnpm start`.",
          "Run one worker container for `pnpm worker` when NP_ENABLE_JOBS=1.",
          "Terminate TLS at Caddy, NGINX, or your platform load balancer.",
        ],
        commands: commonCommands,
      };
  }
}

function envStatus(name: string): string {
  const [variable, ...expectedParts] = name.split("=");
  const expected = expectedParts.length > 0 ? expectedParts.join("=") : null;
  const value = process.env[variable!];
  if (!value) return `${COLOR.yellow}[todo]${COLOR.reset} ${name}`;
  if (expected && value !== expected) {
    return `${COLOR.yellow}[check]${COLOR.reset} ${name} ${COLOR.dim}(currently ${variable}=${value})${COLOR.reset}`;
  }
  return `${COLOR.green}[set]${COLOR.reset} ${name}`;
}

function printSection(title: string, lines: string[]): void {
  console.log(`\n${COLOR.cyan}${title}${COLOR.reset}`);
  for (const line of lines) console.log(`  - ${line}`);
}

function printPlan(plan: TargetPlan, inferred: boolean): void {
  console.log(`${COLOR.cyan}NexPress deploy plan: ${plan.title}${COLOR.reset}`);
  if (inferred) {
    console.log(`${COLOR.dim}No --target supplied; inferred ${plan.target}.${COLOR.reset}`);
  }

  printSection("Fit", plan.fit);
  printSection("Required env", plan.requiredEnv.map(envStatus));
  printSection("Recommended env", plan.recommendedEnv.map(envStatus));
  printSection("Storage", plan.storage);
  printSection("Runtime", plan.runtime);
  printSection("Run before deploy", plan.commands);

  console.log(
    `\n${COLOR.dim}Use \`pnpm run doctor:prod -- --target ${plan.target}\` as the failing readiness gate; deploy:plan is advisory.${COLOR.reset}`,
  );
}

try {
  const argv = process.argv.slice(2);
  if (shouldPrintHelp(argv)) {
    printHelp();
    process.exit(0);
  }
  const explicitTarget = parseDeployTargetArg(argv);
  const target = explicitTarget ?? inferDeployTargetFromEnv() ?? "docker";
  printPlan(planFor(target), explicitTarget === null);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

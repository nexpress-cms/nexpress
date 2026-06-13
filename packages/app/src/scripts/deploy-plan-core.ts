import { deployTargetTitle, type DeployTarget } from "./deploy-targets.js";

export interface TargetPlan {
  target: DeployTarget;
  title: string;
  fit: string[];
  requiredEnv: string[];
  recommendedEnv: string[];
  storage: string[];
  runtime: string[];
  commands: string[];
  diagnostics?: string[];
}

export type EnvRequirementStatus = "set" | "missing" | "mismatch";

export interface EnvRequirementCheck {
  name: string;
  variable: string;
  expectedValue?: string;
  actualValue?: string;
  status: EnvRequirementStatus;
  hint?: string;
}

export interface DeployPlanEnvSummary {
  total: number;
  set: number;
  unresolved: number;
}

export interface DeployPlanSummary {
  requiredEnv: DeployPlanEnvSummary;
  recommendedEnv: DeployPlanEnvSummary;
}

export interface DeployPlanJson {
  schemaVersion: "np.deploy-plan.v1";
  target: DeployTarget;
  title: string;
  inferred: boolean;
  dryRun: boolean;
  summary: DeployPlanSummary;
  fit: string[];
  requiredEnv: EnvRequirementCheck[];
  recommendedEnv: EnvRequirementCheck[];
  storage: string[];
  runtime: string[];
  commands: string[];
  nextCommands: string[];
  diagnostics: string[];
}

type DeployPlanEnv = Record<string, string | undefined>;

interface RenderOptions {
  color: boolean;
}

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const EMPTY_ANSI = {
  green: "",
  yellow: "",
  cyan: "",
  dim: "",
  reset: "",
};

export function buildDeployPlan(target: DeployTarget): TargetPlan {
  const commonRequired = ["DATABASE_URL", "NP_SECRET", "SITE_URL"];
  const commonRecommended = ["NP_ENABLE_JOBS=1", "NP_SCHEDULER_TOKEN"];
  const doctorCommand = `pnpm run doctor:prod -- --target ${target}`;
  const commonCommands = [
    "pnpm install",
    "pnpm run setup -- --non-interactive",
    "pnpm db:migrate -- --status",
    "pnpm db:migrate",
    doctorCommand,
  ];
  const commonDiagnostics = [
    `Run ${doctorCommand} --brief --no-color --fix-plan for ordered remediation.`,
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
          "Set the required env vars in Vercel Project Settings before the first production deploy.",
          "Set SITE_URL to the final https:// production domain, not localhost.",
          "Run migrations against the same DATABASE_URL that Vercel will use.",
          "vercel.json already includes the scheduled-publish cron endpoint.",
          "Use a separate worker host if you need long-running pg-boss workers.",
        ],
        commands: commonCommands,
        diagnostics: commonDiagnostics,
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
          "Set SITE_URL to the public HTTPS origin Railway routes to the web service.",
          "Create one worker service for `pnpm run worker` with NP_ENABLE_JOBS=1.",
          "Run migrations before promoting the new image.",
        ],
        commands: commonCommands,
        diagnostics: commonDiagnostics,
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
          "Set SITE_URL to the public HTTPS origin Render routes to the web service.",
          "Create a background worker for `pnpm run worker` with NP_ENABLE_JOBS=1.",
          "Run migrations before the web service receives traffic.",
        ],
        commands: commonCommands,
        diagnostics: commonDiagnostics,
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
          "Set SITE_URL to the public HTTPS origin Fly routes to the web machine.",
          "Run a separate worker process or machine for `pnpm run worker` when jobs are enabled.",
          "Run migrations as a release step before promotion.",
        ],
        commands: commonCommands,
        diagnostics: commonDiagnostics,
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
          "Run one worker container for `pnpm run worker` with NP_ENABLE_JOBS=1.",
          "Terminate TLS at Caddy, NGINX, or your platform load balancer.",
        ],
        commands: commonCommands,
        diagnostics: commonDiagnostics,
      };
  }
}

export function checkEnvRequirement(
  name: string,
  env: DeployPlanEnv = process.env,
): EnvRequirementCheck {
  const [variable = "", ...expectedParts] = name.split("=");
  const expectedValue = expectedParts.length > 0 ? expectedParts.join("=") : undefined;
  const value = env[variable];
  const hint = envRequirementHint(variable, expectedValue);
  if (!value) {
    return {
      name,
      variable,
      ...(expectedValue ? { expectedValue } : {}),
      status: "missing",
      ...(hint ? { hint } : {}),
    };
  }
  if (expectedValue && value !== expectedValue) {
    return {
      name,
      variable,
      expectedValue,
      actualValue: value,
      status: "mismatch",
      ...(hint ? { hint } : {}),
    };
  }
  return {
    name,
    variable,
    ...(expectedValue ? { expectedValue } : {}),
    status: "set",
  };
}

function envRequirementHint(variable: string, expectedValue: string | undefined): string | null {
  if (expectedValue) return `Set ${variable}=${expectedValue}.`;
  switch (variable) {
    case "DATABASE_URL":
      return "Use the public or pooler Postgres connection string for the deploy target.";
    case "NP_SECRET":
      return "Generate a 32+ character secret, for example `openssl rand -base64 48`.";
    case "SITE_URL":
      return "Set this to the final public HTTPS origin, for example `https://example.com`.";
    case "NP_S3_BUCKET":
      return "Set the durable media bucket name for S3, R2, MinIO, or another S3-compatible provider.";
    case "NP_S3_REGION":
      return "Set the bucket region; use `auto` for providers such as Cloudflare R2 when appropriate.";
    case "NP_S3_ENDPOINT":
      return "Set this for R2, MinIO, or non-AWS S3-compatible storage.";
    case "NP_ENABLE_JOBS":
      return "Set to `1` on the runtime that owns scheduled publishing, email, and background jobs.";
    case "NP_SCHEDULER_TOKEN":
      return "Set a random token if an external cron calls internal scheduled endpoints.";
    default:
      return null;
  }
}

function summarizeEnvRequirements(checks: EnvRequirementCheck[]): DeployPlanEnvSummary {
  const set = checks.filter((check) => check.status === "set").length;
  return {
    total: checks.length,
    set,
    unresolved: checks.length - set,
  };
}

function buildDeployPlanNextCommands(
  plan: TargetPlan,
  requiredEnv: EnvRequirementCheck[],
): string[] {
  const doctorCommand = `pnpm run doctor:prod -- --target ${plan.target} --brief --no-color --fix-plan`;
  const hasUnresolvedRequiredEnv = requiredEnv.some((check) => check.status !== "set");

  if (hasUnresolvedRequiredEnv) {
    return [doctorCommand];
  }

  return ["pnpm db:migrate -- --status", "pnpm db:migrate", doctorCommand];
}

export function buildDeployPlanJson(
  plan: TargetPlan,
  inferred: boolean,
  env: DeployPlanEnv = process.env,
): DeployPlanJson {
  const requiredEnv = plan.requiredEnv.map((name) => checkEnvRequirement(name, env));
  const recommendedEnv = plan.recommendedEnv.map((name) => checkEnvRequirement(name, env));

  return {
    schemaVersion: "np.deploy-plan.v1",
    target: plan.target,
    title: plan.title,
    inferred,
    dryRun: true,
    summary: {
      requiredEnv: summarizeEnvRequirements(requiredEnv),
      recommendedEnv: summarizeEnvRequirements(recommendedEnv),
    },
    fit: plan.fit,
    requiredEnv,
    recommendedEnv,
    storage: plan.storage,
    runtime: plan.runtime,
    commands: plan.commands,
    nextCommands: buildDeployPlanNextCommands(plan, requiredEnv),
    diagnostics: plan.diagnostics ?? [],
  };
}

export function formatEnvRequirement(check: EnvRequirementCheck, color = true): string {
  const c = color ? ANSI : EMPTY_ANSI;
  const hint = check.hint ? ` ${c.dim}- ${check.hint}${c.reset}` : "";
  if (check.status === "missing") return `${c.yellow}[todo]${c.reset} ${check.name}${hint}`;
  if (check.status === "mismatch") {
    return (
      `${c.yellow}[check]${c.reset} ${check.name} ` +
      `${c.dim}(currently ${check.variable}=${check.actualValue ?? ""})${c.reset}${hint}`
    );
  }
  return `${c.green}[set]${c.reset} ${check.name}`;
}

function pushSection(
  lines: string[],
  title: string,
  items: string[],
  options: RenderOptions,
): void {
  const c = options.color ? ANSI : EMPTY_ANSI;
  lines.push("", `${c.cyan}${title}${c.reset}`);
  for (const item of items) lines.push(`  - ${item}`);
}

export function renderDeployPlan(
  plan: TargetPlan,
  inferred: boolean,
  env: DeployPlanEnv = process.env,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [`${c.cyan}NexPress deploy plan: ${plan.title}${c.reset}`];
  const diagnostics = plan.diagnostics ?? [];
  if (inferred) {
    lines.push(`${c.dim}No --target supplied; inferred ${plan.target}.${c.reset}`);
  }

  pushSection(lines, "Fit", plan.fit, options);
  pushSection(
    lines,
    "Required env",
    plan.requiredEnv.map((name) =>
      formatEnvRequirement(checkEnvRequirement(name, env), options.color),
    ),
    options,
  );
  pushSection(
    lines,
    "Recommended env",
    plan.recommendedEnv.map((name) =>
      formatEnvRequirement(checkEnvRequirement(name, env), options.color),
    ),
    options,
  );
  pushSection(lines, "Storage", plan.storage, options);
  pushSection(lines, "Runtime", plan.runtime, options);
  pushSection(lines, "Run before deploy", plan.commands, options);
  if (diagnostics.length > 0) pushSection(lines, "Diagnostics", diagnostics, options);

  lines.push(
    "",
    `${c.dim}Use \`pnpm run doctor:prod -- --target ${plan.target}\` as the failing readiness gate; deploy:plan is advisory.${c.reset}`,
  );

  return lines.join("\n");
}

export function renderBriefDeployPlan(
  plan: TargetPlan,
  inferred: boolean,
  env: DeployPlanEnv = process.env,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const required = plan.requiredEnv.map((name) => checkEnvRequirement(name, env));
  const unresolved = required.filter((check) => check.status !== "set");
  const diagnostics = plan.diagnostics ?? [];
  const lines = [`${c.cyan}NexPress deploy plan: ${plan.title}${c.reset}`];
  if (inferred) lines.push(`${c.dim}No --target supplied; inferred ${plan.target}.${c.reset}`);
  lines.push(
    `Required env: ${String(required.length - unresolved.length)}/${String(required.length)} set`,
  );
  for (const check of unresolved) lines.push(`  - ${formatEnvRequirement(check, options.color)}`);
  lines.push("", "Run before deploy:");
  for (const command of plan.commands) lines.push(`  - ${command}`);
  if (diagnostics.length > 0) {
    lines.push("", "If blocked:");
    for (const diagnostic of diagnostics) lines.push(`  - ${diagnostic}`);
  }
  return lines.join("\n");
}

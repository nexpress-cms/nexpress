import type { DeployTarget } from "./deploy-targets.js";
import type { CheckResult } from "./doctor-readiness.js";

export interface DoctorFixPlanItem {
  id: string;
  checkIds: string[];
  title: string;
  severity: "info" | "warning" | "blocking";
  blocksDeploy: boolean;
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  nextCommand: string | null;
  commands: string[];
  notes?: string[];
}

type FixPlanTemplate = Omit<
  DoctorFixPlanItem,
  "blocksDeploy" | "checkIds" | "nextCommand" | "severity"
>;

function targetDeployPlanCommand(target: DeployTarget | null, fallback: DeployTarget): string {
  return `pnpm run deploy:plan -- --target ${target ?? fallback} --brief --no-color`;
}

function mergeFixPlanItem(
  plan: DoctorFixPlanItem[],
  result: CheckResult,
  template: FixPlanTemplate,
): void {
  const severity =
    result.state === "error" ? "blocking" : result.state === "warn" ? "warning" : "info";
  const blocksDeploy = result.state === "error";
  const existing = plan.find((item) => item.id === template.id);
  if (existing) {
    if (!existing.checkIds.includes(result.id)) existing.checkIds.push(result.id);
    if (blocksDeploy) {
      existing.blocksDeploy = true;
      existing.severity = "blocking";
    }
    return;
  }
  plan.push({
    ...template,
    blocksDeploy,
    checkIds: [result.id],
    nextCommand: template.commands[0] ?? null,
    severity,
  });
}

function fixForCheck(result: CheckResult, target: DeployTarget | null): FixPlanTemplate | null {
  switch (result.id) {
    case "node.version":
      return {
        id: "runtime.install_node_20",
        title: "Install Node.js 20 or newer",
        risk: "low",
        requiresApproval: false,
        commands: ["node --version"],
        notes: ["Use nvm, asdf, fnm, or your system package manager to install Node.js 20+."],
      };
    case "pnpm.version":
      return {
        id: "runtime.install_pnpm_10_33",
        title: "Activate pnpm 10.33 or newer",
        risk: "low",
        requiresApproval: false,
        commands: ["corepack enable", "corepack prepare pnpm@10.33.0 --activate"],
      };
    case "env.file":
    case "env.database_url":
    case "env.site_url":
      return {
        id: "env.run_setup",
        title: "Create or update the environment file",
        risk: "low",
        requiresApproval: false,
        commands: ["pnpm run setup"],
      };
    case "env.np_secret":
      if (result.detail === "not set") {
        return {
          id: "env.run_setup",
          title: "Create or update the environment file",
          risk: "low",
          requiresApproval: false,
          commands: ["pnpm run setup"],
        };
      }
      return {
        id: "env.rotate_np_secret",
        title: "Generate a strong NP_SECRET and update the environment",
        risk: "medium",
        requiresApproval: true,
        commands: ["openssl rand -base64 48"],
        notes: ["Changing NP_SECRET invalidates existing sessions."],
      };
    case "env.np_secret_placeholder":
    case "prod.secret_length":
      return {
        id: "env.rotate_np_secret",
        title: "Generate a strong NP_SECRET and update the environment",
        risk: "medium",
        requiresApproval: true,
        commands: ["openssl rand -base64 48"],
        notes: ["Changing NP_SECRET invalidates existing sessions."],
      };
    case "database.reachable":
      return {
        id: "database.start_or_configure",
        title: "Start Postgres or update DATABASE_URL",
        risk: "low",
        requiresApproval: false,
        commands: ["docker compose -f docker/docker-compose.yml up -d db", "pnpm run setup"],
      };
    case "migrations.applied":
      return {
        id: "database.apply_migrations",
        title: "Generate schema and apply database migrations",
        risk: "medium",
        requiresApproval: true,
        commands: ["pnpm db:generate", "pnpm db:migrate"],
      };
    case "storage.local_directory":
      return {
        id: "storage.create_local_directory",
        title: "Create the local media directory",
        risk: "low",
        requiresApproval: false,
        commands: ["mkdir -p public/media"],
        notes: ["Use NP_STORAGE_DIR if the project configured a custom media path."],
      };
    case "storage.s3_settings":
    case "prod.storage_adapter":
      return {
        id: "storage.configure_s3",
        title: "Configure durable S3-compatible media storage",
        risk: "medium",
        requiresApproval: true,
        commands: ["pnpm run setup"],
        notes: [
          "Set NP_STORAGE_ADAPTER=s3, NP_S3_BUCKET, NP_S3_REGION, and NP_S3_ENDPOINT for non-AWS providers.",
        ],
      };
    case "prod.jobs_enabled":
      return {
        id: "jobs.enable_worker",
        title: "Enable and run the background worker",
        risk: "low",
        requiresApproval: false,
        commands: ["pnpm worker"],
        notes: ["Set NP_ENABLE_JOBS=1 on the runtime that owns the long-running worker."],
      };
    case "prod.site_url_https":
      return {
        id: "site.configure_https_url",
        title: "Point SITE_URL at the production HTTPS origin",
        risk: "low",
        requiresApproval: false,
        commands: ["pnpm run setup"],
      };
    case "prod.scheduler_token":
      return {
        id: "scheduler.generate_token",
        title: "Generate a scheduler token and configure the cron caller",
        risk: "low",
        requiresApproval: false,
        commands: ["openssl rand -hex 32"],
        notes: [
          "Set NP_SCHEDULER_TOKEN to the generated value and send Authorization: Bearer <token> from the scheduler.",
        ],
      };
    default:
      if (result.id.startsWith("target.") && result.id.endsWith(".storage")) {
        return {
          id: "storage.configure_target_durable_storage",
          title: "Configure storage for the selected deployment target",
          risk: "medium",
          requiresApproval: true,
          commands: [targetDeployPlanCommand(target, "vercel"), "pnpm run setup"],
        };
      }
      if (result.id.startsWith("target.") && result.id.endsWith(".database_url")) {
        return {
          id: "database.configure_target_postgres",
          title: "Configure a hosted Postgres DATABASE_URL for the selected deployment target",
          risk: "medium",
          requiresApproval: true,
          commands: [targetDeployPlanCommand(target, "vercel"), "pnpm run setup"],
          notes: [
            "Set DATABASE_URL to the hosted provider's public or pooler connection string.",
            "Localhost, Docker-only hosts, and private LAN IPs work locally but are not reachable from hosted deploy runtimes.",
          ],
        };
      }
      if (result.id.startsWith("target.") && result.id.endsWith(".site_url")) {
        return {
          id: "site.configure_target_public_url",
          title: "Point SITE_URL at the selected deployment target's public origin",
          risk: "low",
          requiresApproval: false,
          commands: [targetDeployPlanCommand(target, "vercel"), "pnpm run setup"],
          notes: [
            "Use the final https:// origin, not localhost or a private network address.",
            "SITE_URL is used for auth redirects, email links, SEO metadata, and canonical URLs.",
          ],
        };
      }
      if (result.id.startsWith("target.") && result.id.endsWith(".jobs_worker")) {
        return {
          id: "jobs.add_target_worker_host",
          title: "Add a worker runtime for the selected deployment target",
          risk: "medium",
          requiresApproval: true,
          commands: [targetDeployPlanCommand(target, "docker"), "pnpm worker"],
        };
      }
      return null;
  }
}

export function buildDoctorFixPlan(args: {
  checks: CheckResult[];
  target: DeployTarget | null;
}): DoctorFixPlanItem[] {
  const plan: DoctorFixPlanItem[] = [];
  for (const result of args.checks) {
    if (result.state === "ok") continue;
    const template = fixForCheck(result, args.target);
    if (template) mergeFixPlanItem(plan, result, template);
  }
  return plan;
}

import type { OpsReadinessReport, OpsReadinessSection } from "./ops-readiness";
import type { Check, HealthSummary } from "./system-health";

export type AdminOpsState = Check["state"];

export interface AdminOpsLink {
  label: string;
  href: string;
}

export interface HealthAction {
  id: string;
  title: string;
  state: AdminOpsState;
  summary: string;
  command: string | null;
  links: AdminOpsLink[];
}

export interface AdminOpsOverviewCard {
  id: string;
  label: string;
  value: string;
  helper: string;
  state: AdminOpsState;
  href: string;
}

export interface AdminOpsOverview {
  state: AdminOpsState;
  nextCommand: string | null;
  cards: AdminOpsOverviewCard[];
}

const STALE_MIGRATION_TRACKING_COMMAND =
  'docker compose exec db psql -U nexpress -d nexpress -c "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" && pnpm db:migrate';

export function stateFromHealthSummary(summary: HealthSummary): AdminOpsState {
  if (summary.errorCount > 0) return "error";
  if (summary.warnCount > 0) return "warn";
  return "ok";
}

export function statusLabelForState(state: AdminOpsState): string {
  if (state === "error") return "Blocked";
  if (state === "warn") return "Attention";
  return "Ready";
}

export function buildHealthActions(summary: HealthSummary): HealthAction[] {
  return summary.checks
    .filter((check) => check.state !== "ok")
    .map((check) => ({
      id: check.id,
      title: check.label,
      state: check.state,
      summary: check.hint ?? check.detail ?? "Review this health probe.",
      command: commandForHealthCheck(check),
      links: relatedLinksForHealthCheck(check.id),
    }));
}

export function healthNextCommand(summary: HealthSummary): string | null {
  const actions = buildHealthActions(summary);
  const errorCommand = actions.find((action) => action.state === "error" && action.command);
  if (errorCommand?.command) return errorCommand.command;
  return actions.find((action) => action.command)?.command ?? null;
}

export function commandForHealthCheck(check: Check): string | null {
  switch (check.id) {
    case "db":
      return "pnpm run doctor -- --fix-plan";
    case "migrations":
      return check.detail?.includes("drizzle tracks")
        ? STALE_MIGRATION_TRACKING_COMMAND
        : "pnpm db:migrate";
    case "storage":
      return "pnpm --silent run ops:storage -- verify --json";
    case "queue":
      return check.detail === "paused"
        ? "pnpm --silent run ops:jobs -- resume --json"
        : "pnpm --silent run ops:jobs -- --json";
    case "plugins":
      return "pnpm --silent run ops:plugins -- doctor --json";
    case "site_url":
    case "email":
    case "secret":
      return "pnpm run setup";
    default:
      return null;
  }
}

export function relatedLinksForHealthCheck(id: Check["id"]): AdminOpsLink[] {
  switch (id) {
    case "db":
    case "migrations":
    case "site_url":
    case "email":
    case "secret":
      return [
        { label: "Readiness", href: "/admin/readiness" },
        { label: "Settings", href: "/admin/settings" },
      ];
    case "storage":
      return [
        { label: "Media", href: "/admin/media" },
        { label: "Readiness", href: "/admin/readiness" },
      ];
    case "queue":
      return [{ label: "Jobs", href: "/admin/jobs" }];
    case "plugins":
      return [{ label: "Plugins", href: "/admin/plugins" }];
    default:
      return [];
  }
}

export function buildAdminOpsOverview(
  health: HealthSummary,
  readiness: OpsReadinessReport,
): AdminOpsOverview {
  const healthState = stateFromHealthSummary(health);
  const readinessState = stateFromReadinessStatus(readiness.status);
  const jobs = readiness.sections.find((section) => section.id === "jobs");
  const storage = readiness.sections.find((section) => section.id === "storage");
  const plugins = readiness.sections.find((section) => section.id === "plugins");
  const cards: AdminOpsOverviewCard[] = [
    {
      id: "health",
      label: "Runtime health",
      value: statusLabelForState(healthState),
      helper: `${health.errorCount.toString()} errors · ${health.warnCount.toString()} warnings`,
      state: healthState,
      href: "/admin/health",
    },
    {
      id: "readiness",
      label: "Deploy readiness",
      value: statusLabelForState(readinessState),
      helper: `${readiness.targetTitle} · ${readiness.summary.errors.toString()} blocked sections`,
      state: readinessState,
      href: `/admin/readiness?target=${readiness.target}`,
    },
    sectionCard("jobs", "Jobs", jobs, "/admin/jobs"),
    sectionCard("storage", "Storage", storage, `/admin/readiness?target=${readiness.target}`),
    sectionCard("plugins", "Plugins", plugins, "/admin/plugins"),
  ];
  const state = mostSevereState(cards.map((card) => card.state));

  return {
    state,
    nextCommand: healthNextCommand(health) ?? readiness.projectNextCommand ?? readiness.nextCommand,
    cards,
  };
}

export function stateFromReadinessStatus(status: OpsReadinessReport["status"]): AdminOpsState {
  if (status === "blocked") return "error";
  if (status === "attention") return "warn";
  return "ok";
}

export function commandForReadinessSection(section: OpsReadinessSection): string | null {
  return section.projectNextCommand ?? section.nextCommand;
}

function sectionCard(
  id: string,
  label: string,
  section: OpsReadinessSection | undefined,
  href: string,
): AdminOpsOverviewCard {
  if (!section) {
    return {
      id,
      label,
      value: "Unknown",
      helper: "No evidence collected",
      state: "warn",
      href,
    };
  }
  return {
    id,
    label,
    value: statusLabelForState(section.state),
    helper: section.summary,
    state: section.state,
    href,
  };
}

function mostSevereState(states: AdminOpsState[]): AdminOpsState {
  if (states.includes("error")) return "error";
  if (states.includes("warn")) return "warn";
  return "ok";
}

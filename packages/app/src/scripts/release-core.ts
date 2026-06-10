export type ReleaseMode = "check" | "verify";
export type ReleaseStepId =
  | "ops.preflight"
  | "ops.health"
  | "ops.backup"
  | "ops.jobs"
  | "ops.migrate"
  | "ops.storage"
  | "ops.plugins";

export interface ReleaseStepReport {
  schemaVersion?: string;
  ok?: boolean;
  status?: string;
  nextCommand?: string | null;
  summary?: unknown;
}

export interface ReleaseStep {
  id: ReleaseStepId;
  command: string;
  ok: boolean;
  exitCode: number;
  status: string;
  nextCommand: string | null;
  report: ReleaseStepReport | null;
  error?: string;
}

export interface ReleaseJson {
  schemaVersion: "np.release.v1";
  ok: boolean;
  mode: ReleaseMode;
  status: "ready" | "attention" | "blocked";
  target: string | null;
  url: string | null;
  summary: {
    steps: number;
    ready: number;
    attention: number;
    blocked: number;
  };
  nextCommand: string | null;
  steps: ReleaseStep[];
}

interface RenderOptions {
  color: boolean;
}

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const EMPTY_ANSI = {
  green: "",
  yellow: "",
  red: "",
  dim: "",
  reset: "",
};

function stepBlocked(step: ReleaseStep): boolean {
  if (step.report && step.report.ok === false) return true;
  if (step.error) return true;
  return step.exitCode !== 0 && !step.report;
}

function stepAttention(step: ReleaseStep): boolean {
  if (stepBlocked(step)) return false;
  return step.status === "attention" || step.status === "degraded" || step.status === "disabled";
}

export function buildReleaseJson(args: {
  mode: ReleaseMode;
  target?: string | null;
  url?: string | null;
  steps: ReleaseStep[];
}): ReleaseJson {
  const blocked = args.steps.filter(stepBlocked).length;
  const attention = args.steps.filter(stepAttention).length;
  const ready = args.steps.length - blocked - attention;
  const status = blocked > 0 ? "blocked" : attention > 0 ? "attention" : "ready";
  const nextCommand =
    args.steps.find((step) => stepBlocked(step) && step.nextCommand)?.nextCommand ??
    args.steps.find((step) => stepAttention(step) && step.nextCommand)?.nextCommand ??
    (status === "ready"
      ? null
      : args.mode === "check"
        ? "nexpress release check --json"
        : "nexpress release verify --json");

  return {
    schemaVersion: "np.release.v1",
    ok: blocked === 0,
    mode: args.mode,
    status,
    target: args.target ?? null,
    url: args.url ?? null,
    summary: {
      steps: args.steps.length,
      ready,
      attention,
      blocked,
    },
    nextCommand,
    steps: args.steps,
  };
}

function formatState(state: ReleaseJson["status"], color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (state === "ready") return `${c.green}ready${c.reset}`;
  if (state === "attention") return `${c.yellow}attention${c.reset}`;
  return `${c.red}blocked${c.reset}`;
}

function formatStep(step: ReleaseStep, color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  const marker = stepBlocked(step)
    ? `${c.red}[blocked]${c.reset}`
    : stepAttention(step)
      ? `${c.yellow}[attention]${c.reset}`
      : `${c.green}[ok]${c.reset}`;
  const suffix = step.error ? ` - ${step.error}` : ` - ${step.command}`;
  return `${marker} ${step.id} ${step.status}${suffix}`;
}

export function renderBriefReleaseReport(
  report: ReleaseJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const context =
    report.mode === "check"
      ? `target: ${report.target ?? "unknown"}`
      : `url: ${report.url ?? "SITE_URL/default"}`;
  const lines = [
    `${c.dim}NexPress release ${report.mode}${c.reset}`,
    `${formatState(report.status, options.color)}: ${context}`,
    `steps: ${report.summary.ready.toString()} ready, ${report.summary.attention.toString()} attention, ${report.summary.blocked.toString()} blocked`,
  ];
  for (const step of report.steps) lines.push(formatStep(step, options.color));
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  return lines.join("\n");
}

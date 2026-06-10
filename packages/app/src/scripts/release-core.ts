export type ReleaseMode = "check" | "plan" | "verify";
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
  plan?: {
    commands?: unknown;
    nextCommands?: unknown;
  };
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

export interface ReleasePlanCommand {
  phase: "remediate" | "release" | "verify";
  command: string;
  required: boolean;
  requiresApproval: boolean;
}

export interface ReleasePlanJson {
  schemaVersion: "np.release-plan.v1";
  ok: boolean;
  planId: string;
  createdAt: string;
  target: string;
  status: ReleaseJson["status"];
  summary: {
    commands: number;
    remediationCommands: number;
    releaseCommands: number;
    verifyCommands: number;
  };
  apply: {
    allowed: boolean;
    requiresApproval: true;
    blockedReason: string | null;
    nextCommand: string | null;
  };
  audit: {
    artifactPath: string | null;
  };
  commands: ReleasePlanCommand[];
  check: ReleaseJson;
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function releaseCommandsFromCheck(check: ReleaseJson): string[] {
  const preflight = check.steps.find((step) => step.id === "ops.preflight");
  return readStringArray(preflight?.report?.plan?.commands);
}

function commandRequiresApproval(command: string): boolean {
  return command.includes("db:migrate") || command.includes("setup");
}

function remediationCommandsFromCheck(check: ReleaseJson): string[] {
  const stepCommands = check.steps.map((step) => step.nextCommand);
  const preflight = check.steps.find((step) => step.id === "ops.preflight");
  const planNextCommands = readStringArray(preflight?.report?.plan?.nextCommands);
  return uniqueStrings([check.nextCommand, ...stepCommands, ...planNextCommands]);
}

export function buildReleasePlanJson(args: {
  planId: string;
  createdAt: string;
  target: string;
  artifactPath?: string | null;
  check: ReleaseJson;
}): ReleasePlanJson {
  const remediation = remediationCommandsFromCheck(args.check).map<ReleasePlanCommand>(
    (command) => ({
      phase: "remediate",
      command,
      required: !args.check.ok,
      requiresApproval: commandRequiresApproval(command),
    }),
  );
  const release = releaseCommandsFromCheck(args.check).map<ReleasePlanCommand>((command) => ({
    phase: "release",
    command,
    required: true,
    requiresApproval: commandRequiresApproval(command),
  }));
  const verify: ReleasePlanCommand[] = [
    {
      phase: "verify",
      command: "nexpress release verify --json",
      required: true,
      requiresApproval: false,
    },
  ];
  const commands = [...remediation, ...release, ...verify];
  const blockedReason = args.check.ok
    ? null
    : "release check is not ready; run remediation commands and regenerate the plan";

  return {
    schemaVersion: "np.release-plan.v1",
    ok: args.check.ok,
    planId: args.planId,
    createdAt: args.createdAt,
    target: args.target,
    status: args.check.status,
    summary: {
      commands: commands.length,
      remediationCommands: remediation.length,
      releaseCommands: release.length,
      verifyCommands: verify.length,
    },
    apply: {
      allowed: args.check.ok,
      requiresApproval: true,
      blockedReason,
      nextCommand: args.check.ok
        ? `nexpress release apply --plan ${args.artifactPath ?? "<plan>"}`
        : args.check.nextCommand,
    },
    audit: {
      artifactPath: args.artifactPath ?? null,
    },
    commands,
    check: args.check,
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

export function renderBriefReleasePlan(
  plan: ReleasePlanJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [
    `${c.dim}NexPress release plan${c.reset}`,
    `${formatState(plan.status, options.color)}: target: ${plan.target}`,
    `plan: ${plan.planId}`,
    `commands: ${plan.summary.commands.toString()} total, ${plan.summary.remediationCommands.toString()} remediation, ${plan.summary.releaseCommands.toString()} release`,
  ];
  if (plan.audit.artifactPath) lines.push(`artifact: ${plan.audit.artifactPath}`);
  if (!plan.apply.allowed && plan.apply.blockedReason) {
    lines.push(`blocked: ${plan.apply.blockedReason}`);
  }
  for (const command of plan.commands) {
    const approval = command.requiresApproval ? " approval" : "";
    lines.push(`  - [${command.phase}${approval}] ${command.command}`);
  }
  if (plan.apply.nextCommand) lines.push(`Next: ${plan.apply.nextCommand}`);
  return lines.join("\n");
}

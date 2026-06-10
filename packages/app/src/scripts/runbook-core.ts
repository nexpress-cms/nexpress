export type RunbookId =
  | "worker-not-draining"
  | "storage-local-to-s3"
  | "backup-restore-drill"
  | "migration-crashed";

export interface RunbookEvidence {
  id: string;
  command: string;
  ok: boolean;
  status: string;
  summary?: unknown;
  nextCommand?: string | null;
  error?: string;
}

export interface RunbookJson {
  schemaVersion: "np.runbook.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  runbook: RunbookId;
  title: string;
  diagnosis: string;
  risk: "low" | "medium" | "high";
  nextCommands: string[];
  rollbackNotes: string[];
  docs: string[];
  evidence: RunbookEvidence[];
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

function evidenceBlocked(evidence: RunbookEvidence): boolean {
  return !evidence.ok || evidence.status === "blocked" || evidence.status === "unreachable";
}

function evidenceAttention(evidence: RunbookEvidence): boolean {
  return !evidenceBlocked(evidence) && evidence.status !== "ready";
}

function summarizeEvidence(evidence: RunbookEvidence[]): RunbookJson["status"] {
  if (evidence.some(evidenceBlocked)) return "blocked";
  if (evidence.some(evidenceAttention)) return "attention";
  return "ready";
}

function evidenceNextCommands(evidence: RunbookEvidence[]): string[] {
  return [
    ...new Set(
      evidence
        .map((item) => item.nextCommand)
        .filter((command): command is string => Boolean(command)),
    ),
  ];
}

export function buildRunbookJson(args: {
  runbook: RunbookId;
  evidence: RunbookEvidence[];
}): RunbookJson {
  const status = summarizeEvidence(args.evidence);
  const evidenceCommands = evidenceNextCommands(args.evidence);
  switch (args.runbook) {
    case "worker-not-draining":
      return {
        schemaVersion: "np.runbook.v1",
        ok: status !== "blocked",
        status,
        runbook: args.runbook,
        title: "Worker not draining",
        diagnosis:
          status === "ready"
            ? "Worker and queue evidence does not show a drain blocker."
            : "Jobs evidence needs operator attention before queue drain can be trusted.",
        risk: status === "blocked" ? "high" : "medium",
        nextCommands:
          evidenceCommands.length > 0
            ? evidenceCommands
            : ["nexpress ops jobs status --json", "pnpm worker"],
        rollbackNotes: [
          "Do not retry or drain jobs blindly; inspect failed/retry counts first.",
          "If a deploy introduced the backlog, roll back the app version before retrying destructive jobs.",
        ],
        docs: ["docs/agent-operated-ops.md#issue-7--add-executable-runbook-commands"],
        evidence: args.evidence,
      };
    case "storage-local-to-s3":
      return {
        schemaVersion: "np.runbook.v1",
        ok: status !== "blocked",
        status,
        runbook: args.runbook,
        title: "Storage local to S3",
        diagnosis:
          status === "ready"
            ? "Storage evidence is ready for planning a local-to-S3 migration."
            : "Storage evidence needs cleanup or configuration review before migration planning.",
        risk: "high",
        nextCommands:
          evidenceCommands.length > 0
            ? evidenceCommands
            : [
                "nexpress ops storage status --json",
                "nexpress ops preflight --target vercel --json",
              ],
        rollbackNotes: [
          "Keep local media read-only until S3 object counts and sampled URLs are verified.",
          "Do not delete local uploads until a restore path from the S3 bucket has been tested.",
        ],
        docs: ["docs/agent-operated-ops.md#issue-5--add-jobs--storage--plugin-ops-checks"],
        evidence: args.evidence,
      };
    case "backup-restore-drill":
      return {
        schemaVersion: "np.runbook.v1",
        ok: status !== "blocked",
        status,
        runbook: args.runbook,
        title: "Backup restore drill",
        diagnosis:
          status === "ready"
            ? "Current ops evidence is ready enough to schedule a restore drill."
            : "Readiness evidence should be cleaned up before trusting a backup restore drill.",
        risk: "high",
        nextCommands:
          evidenceCommands.length > 0
            ? evidenceCommands
            : [
                "nexpress ops backup verify latest --json",
                "nexpress release check --target docker --json",
              ],
        rollbackNotes: [
          "Run restore drills against an isolated database and media snapshot, never production.",
          "Record the migration version, app commit, and media manifest with every backup artifact.",
        ],
        docs: ["docs/agent-operated-ops.md#issue-4--add-backup--restore-cli"],
        evidence: args.evidence,
      };
    case "migration-crashed":
      return {
        schemaVersion: "np.runbook.v1",
        ok: status !== "blocked",
        status,
        runbook: args.runbook,
        title: "Migration crashed",
        diagnosis:
          status === "ready"
            ? "Migration evidence does not show drift or missing readiness."
            : "Migration or readiness evidence is blocked; inspect migration status before retrying.",
        risk: status === "blocked" ? "high" : "medium",
        nextCommands:
          evidenceCommands.length > 0
            ? evidenceCommands
            : ["nexpress ops migrate status --json", "nexpress ops migrate plan --json"],
        rollbackNotes: [
          "Do not edit applied migration SQL to match a failed database by hand.",
          "Restore the database or migration files from the matching commit before retrying apply.",
        ],
        docs: ["docs/agent-operated-ops.md#issue-3--add-safe-migration-workflow"],
        evidence: args.evidence,
      };
  }
}

function formatState(state: RunbookJson["status"], color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (state === "ready") return `${c.green}ready${c.reset}`;
  if (state === "attention") return `${c.yellow}attention${c.reset}`;
  return `${c.red}blocked${c.reset}`;
}

export function renderBriefRunbook(
  report: RunbookJson,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const lines = [
    `${c.dim}NexPress runbook${c.reset}`,
    `${formatState(report.status, options.color)}: ${report.title}`,
    `risk: ${report.risk}`,
    `diagnosis: ${report.diagnosis}`,
    "evidence:",
  ];
  for (const item of report.evidence) {
    lines.push(`  - ${item.ok ? "[ok]" : "[blocked]"} ${item.id} ${item.status}`);
  }
  if (report.nextCommands.length > 0) {
    lines.push("next:");
    for (const command of report.nextCommands) lines.push(`  - ${command}`);
  }
  if (report.rollbackNotes.length > 0) {
    lines.push("rollback notes:");
    for (const note of report.rollbackNotes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

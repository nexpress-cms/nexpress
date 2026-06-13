// Must be first so SITE_URL is available before selecting the probe URL.
import "./_load-env.js";

import { toProjectCommand } from "./ops-command-format.js";

interface OpsHealthJson {
  schemaVersion: "np.ops-health.v1";
  ok: boolean;
  status: "ready" | "unreachable" | "degraded";
  url: string;
  httpStatus: number | null;
  nextCommand: string | null;
  projectNextCommand: string | null;
  response: unknown;
  error?: string;
}

const ARGV = process.argv.slice(2);
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

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

function printHelp(): void {
  console.log(`NexPress ops health

Usage:
  pnpm run ops:health
  pnpm run ops:health -- --url https://example.com --json
  nexpress ops health --url http://localhost:3000 --brief --no-color

Options:
  --url <origin> Probe origin. Defaults to SITE_URL, then http://localhost:3000.
  --json         Print the stable machine-readable health report.
  --brief        Print compact human output. This is the default.
  --no-color     Disable ANSI color in human-readable output.
  --help, -h     Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function readUrlArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") return argv[i + 1] ?? null;
    if (arg?.startsWith("--url=")) return arg.slice("--url=".length);
  }
  return null;
}

function readinessUrl(origin: string): string {
  const parsed = new URL(origin);
  parsed.pathname = "/api/health/ready";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function probe(url: string): Promise<OpsHealthJson> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    const nextCommand = response.ok ? null : "nexpress ops status --json";
    return {
      schemaVersion: "np.ops-health.v1",
      ok: response.ok,
      status: response.ok ? "ready" : "degraded",
      url,
      httpStatus: response.status,
      nextCommand,
      projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
      response: body,
    };
  } catch (error) {
    const nextCommand = "nexpress ops status --json";
    return {
      schemaVersion: "np.ops-health.v1",
      ok: false,
      status: "unreachable",
      url,
      httpStatus: null,
      nextCommand,
      projectNextCommand: toProjectCommand(nextCommand),
      response: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderBrief(report: OpsHealthJson, color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  const state =
    report.status === "ready"
      ? `${c.green}ready${c.reset}`
      : report.status === "degraded"
        ? `${c.yellow}degraded${c.reset}`
        : `${c.red}unreachable${c.reset}`;
  const lines = [
    `${c.dim}NexPress ops health${c.reset}`,
    `${state}: ${report.url}`,
    `http: ${report.httpStatus === null ? "n/a" : report.httpStatus.toString()}`,
  ];
  if (report.error) lines.push(`error: ${report.error}`);
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }

  const origin = readUrlArg(ARGV) ?? process.env.SITE_URL ?? "http://localhost:3000";
  const report = await probe(readinessUrl(origin));
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBrief(report, COLOR_MODE));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});

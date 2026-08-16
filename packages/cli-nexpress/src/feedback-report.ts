import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { buildRunScriptArgs } from "./ops-command.js";
import type { NpPackageManager } from "./package-manager.js";

export const NEXPRESS_FEEDBACK_URL =
  "https://github.com/nexpress-cms/nexpress/issues/new?template=install_feedback.yml";

const MAX_JSON_BYTES = 256 * 1024;
const MAX_DOCTOR_OUTPUT_BYTES = 512 * 1024;
const MAX_NEXPRESS_PACKAGES = 64;
const MAX_DOCTOR_CHECKS = 512;
const DOCTOR_TIMEOUT_MS = 60_000;
const publicNexpressPackages = new Set([
  "@nexpress/admin",
  "@nexpress/app",
  "@nexpress/auth-pages",
  "@nexpress/blocks",
  "@nexpress/cli",
  "@nexpress/core",
  "@nexpress/editor",
  "@nexpress/gettext",
  "@nexpress/next",
  "@nexpress/oauth-providers",
  "@nexpress/plugin-analytics-lite",
  "@nexpress/plugin-block-callout",
  "@nexpress/plugin-block-embed",
  "@nexpress/plugin-block-latest-posts",
  "@nexpress/plugin-block-newsletter",
  "@nexpress/plugin-block-pricing",
  "@nexpress/plugin-block-stats",
  "@nexpress/plugin-forum",
  "@nexpress/plugin-oauth-github",
  "@nexpress/plugin-oauth-google",
  "@nexpress/plugin-reading-time",
  "@nexpress/plugin-sdk",
  "@nexpress/plugin-seo-audit",
  "@nexpress/plugin-shop",
  "@nexpress/plugin-webhook-relay",
  "@nexpress/rate-limiter-redis",
  "@nexpress/shop-payment-stripe",
  "@nexpress/shop-payment-toss",
  "@nexpress/theme",
  "@nexpress/theme-community",
  "@nexpress/theme-default",
  "@nexpress/theme-docs",
  "@nexpress/theme-magazine",
  "@nexpress/theme-portfolio",
  "@nexpress/theme-storefront",
  "@nexpress/translation",
  "@nexpress/wp-import",
  "@nexpress/xliff",
]);
const versionPattern = /^\d+\.\d+\.\d+$/;
const nodeVersionPattern = /^v\d+\.\d+\.\d+$/;
const publicDoctorCheckIds = new Set([
  "auth.contract",
  "collections.contract",
  "community.contract",
  "community.realtime_capacity",
  "community.realtime_retention",
  "database.reachable",
  "email.contract",
  "env.database_url",
  "env.file",
  "env.np_secret",
  "env.np_secret_placeholder",
  "env.site_url",
  "i18n.contract",
  "jobs.contract",
  "jobs.enabled_contract",
  "media.contract",
  "migrations.applied",
  "node.version",
  "oauth.github.credentials",
  "oauth.google.credentials",
  "observability.contract",
  "pnpm.version",
  "prod.jobs_enabled",
  "prod.observability",
  "prod.scheduler_token",
  "prod.secret_length",
  "prod.site_url_https",
  "prod.storage_adapter",
  "rate-limit.contract",
  "revisions.contract",
  "routes.contract",
  "settings.contract",
  "sites.quotas",
  "storage.contract",
  "storage.local_directory",
  ...["docker", "fly", "railway", "render", "vercel"].flatMap((target) => [
    `target.${target}.database_url`,
    `target.${target}.jobs_worker`,
    `target.${target}.site_url`,
    `target.${target}.storage`,
  ]),
]);
const nodePlatforms = new Set([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "openbsd",
  "sunos",
  "win32",
]);
const nodeArchitectures = new Set([
  "arm",
  "arm64",
  "ia32",
  "loong64",
  "mips",
  "mipsel",
  "ppc",
  "ppc64",
  "riscv64",
  "s390",
  "s390x",
  "x64",
]);

export type FeedbackDoctorState = "ok" | "warn" | "error";

export interface FeedbackDoctorCheck {
  id: string;
  state: FeedbackDoctorState;
}

export interface FeedbackDoctorSection {
  status: "collected" | "invalid" | "unavailable";
  summary: {
    total: number;
    warnings: number;
    errors: number;
  } | null;
  checks: FeedbackDoctorCheck[];
}

export interface NpFeedbackReport {
  schemaVersion: "np.feedback-report.v1";
  environment: {
    node: string;
    platform: string;
    arch: string;
    packageManager: string;
  };
  packages: Array<{ name: string; version: string }>;
  doctor: FeedbackDoctorSection;
  issueUrl: typeof NEXPRESS_FEEDBACK_URL;
}

export type FeedbackDoctorCapture = { kind: "output"; stdout: string } | { kind: "unavailable" };

export interface FeedbackReportRuntime {
  captureDoctor?: (manager: NpPackageManager, cwd: string) => Promise<FeedbackDoctorCapture>;
  nodeVersion?: string;
  platform?: string;
  arch?: string;
}

interface ProjectPackageJson {
  packageManager?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedJson(path: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_JSON_BYTES) {
    throw new Error("JSON input exceeds the feedback-report boundary");
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function directNexpressPackageNames(project: ProjectPackageJson): string[] {
  const names = new Set<string>();
  for (const block of [project.dependencies, project.devDependencies]) {
    if (!isRecord(block)) continue;
    for (const name of Object.keys(block)) {
      if (publicNexpressPackages.has(name)) names.add(name);
    }
  }
  return [...names].sort().slice(0, MAX_NEXPRESS_PACKAGES);
}

async function readInstalledNexpressPackages(
  cwd: string,
  project: ProjectPackageJson,
): Promise<Array<{ name: string; version: string }>> {
  const packages: Array<{ name: string; version: string }> = [];
  for (const name of directNexpressPackageNames(project)) {
    const [scope, packageName] = name.split("/");
    if (!scope || !packageName) continue;
    try {
      const value = await readBoundedJson(
        resolve(cwd, "node_modules", scope, packageName, "package.json"),
      );
      if (!isRecord(value) || value.name !== name || typeof value.version !== "string") continue;
      if (!versionPattern.test(value.version) || value.version.length > 96) continue;
      packages.push({ name, version: value.version });
    } catch {
      // Missing, oversized, or malformed package metadata is omitted. The
      // support report never falls back to an uninstalled manifest range.
    }
  }
  return packages;
}

function packageManagerLabel(manager: NpPackageManager, declared: unknown): string {
  if (typeof declared !== "string" || declared.length > 96) return manager;
  const match = /^(pnpm|npm|yarn)@(\d+\.\d+\.\d+)$/.exec(declared);
  if (!match || match[1] !== manager) return manager;
  return declared;
}

function doctorScriptExists(project: ProjectPackageJson): boolean {
  return isRecord(project.scripts) && typeof project.scripts.doctor === "string";
}

function safeRuntimeValue(value: string, allowed: ReadonlySet<string>): string {
  return allowed.has(value) ? value : "unknown";
}

function safeNodeVersion(value: string): string {
  return nodeVersionPattern.test(value) && value.length <= 96 ? value : "unknown";
}

export function analyzeFeedbackDoctorOutput(stdout: string): FeedbackDoctorSection {
  if (Buffer.byteLength(stdout) > MAX_DOCTOR_OUTPUT_BYTES) {
    return { status: "invalid", summary: null, checks: [] };
  }
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== "np.doctor.v1") {
      return { status: "invalid", summary: null, checks: [] };
    }
    if (!Array.isArray(parsed.checks) || parsed.checks.length > MAX_DOCTOR_CHECKS) {
      return { status: "invalid", summary: null, checks: [] };
    }
    const seen = new Set<string>();
    const checks: FeedbackDoctorCheck[] = [];
    for (const check of parsed.checks) {
      if (!isRecord(check) || typeof check.id !== "string") {
        return { status: "invalid", summary: null, checks: [] };
      }
      if (!publicDoctorCheckIds.has(check.id) || seen.has(check.id)) {
        return { status: "invalid", summary: null, checks: [] };
      }
      if (check.state !== "ok" && check.state !== "warn" && check.state !== "error") {
        return { status: "invalid", summary: null, checks: [] };
      }
      seen.add(check.id);
      checks.push({ id: check.id, state: check.state });
    }
    return {
      status: "collected",
      summary: {
        total: checks.length,
        warnings: checks.filter((check) => check.state === "warn").length,
        errors: checks.filter((check) => check.state === "error").length,
      },
      checks,
    };
  } catch {
    return { status: "invalid", summary: null, checks: [] };
  }
}

export function captureFeedbackDoctor(
  manager: NpPackageManager,
  cwd: string,
): Promise<FeedbackDoctorCapture> {
  const args = buildRunScriptArgs(manager, "doctor", ["--json"]);
  return new Promise((resolveCapture) => {
    const child = spawn(manager, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    let capturedBytes = 0;
    let finished = false;
    const timeoutRef: { value?: NodeJS.Timeout } = {};
    const finish = (capture: FeedbackDoctorCapture) => {
      if (finished) return;
      finished = true;
      if (timeoutRef.value) clearTimeout(timeoutRef.value);
      resolveCapture(capture);
    };
    const captureChunk = (chunk: Buffer, keep: boolean) => {
      if (finished) return;
      capturedBytes += chunk.byteLength;
      if (capturedBytes > MAX_DOCTOR_OUTPUT_BYTES) {
        child.kill();
        finish({ kind: "unavailable" });
        return;
      }
      if (keep) stdoutChunks.push(chunk);
    };
    child.stdout?.on("data", (chunk: Buffer) => captureChunk(chunk, true));
    child.stderr?.on("data", (chunk: Buffer) => captureChunk(chunk, false));
    child.on("error", () => finish({ kind: "unavailable" }));
    child.on("close", () =>
      finish({ kind: "output", stdout: Buffer.concat(stdoutChunks).toString("utf8") }),
    );
    timeoutRef.value = setTimeout(() => {
      child.kill();
      finish({ kind: "unavailable" });
    }, DOCTOR_TIMEOUT_MS);
    timeoutRef.value.unref();
  });
}

export async function buildFeedbackReport(args: {
  cwd: string;
  packageManager: NpPackageManager;
  runtime?: FeedbackReportRuntime;
}): Promise<NpFeedbackReport> {
  const value = await readBoundedJson(resolve(args.cwd, "package.json"));
  if (!isRecord(value)) throw new Error("Project package.json must contain an object");
  const project: ProjectPackageJson = value;
  const runtime = args.runtime ?? {};
  const captureDoctor = runtime.captureDoctor ?? captureFeedbackDoctor;
  let doctor: FeedbackDoctorSection = { status: "unavailable", summary: null, checks: [] };
  if (doctorScriptExists(project)) {
    const captured = await captureDoctor(args.packageManager, args.cwd);
    doctor =
      captured.kind === "output"
        ? analyzeFeedbackDoctorOutput(captured.stdout)
        : { status: "unavailable", summary: null, checks: [] };
  }
  return {
    schemaVersion: "np.feedback-report.v1",
    environment: {
      node: safeNodeVersion(runtime.nodeVersion ?? process.version),
      platform: safeRuntimeValue(runtime.platform ?? process.platform, nodePlatforms),
      arch: safeRuntimeValue(runtime.arch ?? process.arch, nodeArchitectures),
      packageManager: packageManagerLabel(args.packageManager, project.packageManager),
    },
    packages: await readInstalledNexpressPackages(args.cwd, project),
    doctor,
    issueUrl: NEXPRESS_FEEDBACK_URL,
  };
}

export function renderFeedbackReportMarkdown(report: NpFeedbackReport): string {
  const lines = [
    "# NexPress feedback report",
    "",
    `- Schema: \`${report.schemaVersion}\``,
    `- Node: \`${report.environment.node}\``,
    `- Platform: \`${report.environment.platform}-${report.environment.arch}\``,
    `- Package manager: \`${report.environment.packageManager}\``,
    "",
    "## Installed NexPress packages",
    "",
  ];
  if (report.packages.length === 0) lines.push("- Unavailable");
  else {
    for (const entry of report.packages) lines.push(`- \`${entry.name}\`: \`${entry.version}\``);
  }
  lines.push("", "## Doctor", "", `- Collection: \`${report.doctor.status}\``);
  if (report.doctor.summary) {
    lines.push(
      `- Summary: ${report.doctor.summary.total.toString()} checks, ${report.doctor.summary.errors.toString()} errors, ${report.doctor.summary.warnings.toString()} warnings`,
    );
  }
  for (const check of report.doctor.checks) {
    lines.push(`- \`${check.state}\` \`${check.id}\``);
  }
  lines.push(
    "",
    "This report was generated locally and was not uploaded. It omits raw environment-variable values, filesystem paths, database URLs, Doctor labels/details/hints, logs, and personal data. Review it before sharing.",
    "",
    `Feedback form: ${report.issueUrl}`,
  );
  return lines.join("\n");
}

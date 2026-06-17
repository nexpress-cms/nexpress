import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const runbookScript = resolve(scriptDir, "runbook.ts");

async function createRunbookProject(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "np-runbook-cli-"));
  await mkdir(join(dir, "scripts"));
  await writeFile(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        type: "module",
        scripts: {
          "ops:jobs": "node scripts/ops-jobs.cjs",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  await writeFile(join(dir, "scripts/ops-jobs.cjs"), script, "utf8");
  return dir;
}

function runRunbookCli(cwd: string, args: string[]): Promise<CliRun> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("tsx", [runbookScript, ...args], {
      cwd,
      env: {
        ...process.env,
        PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolveRun({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

describe("runbook CLI", () => {
  it("writes a runbook artifact for a ready evidence command", async () => {
    const dir = await createRunbookProject(`
console.log(JSON.stringify({
  schemaVersion: "np.ops-jobs.v1",
  ok: true,
  status: "ready",
  summary: { failed: 0, retry: 0, created: 0, active: 0 }
}));
`);
    const outPath = join(dir, ".nexpress/runbooks/worker.json");

    const run = await runRunbookCli(dir, ["worker-not-draining", "--json", "--out", outPath]);
    const report = JSON.parse(run.stdout) as {
      ok: boolean;
      schemaVersion: string;
      evidence: Array<{ exitCode: number; ok: boolean; status: string }>;
    };
    const artifact = JSON.parse(await readFile(outPath, "utf8")) as typeof report;

    expect(run.exitCode).toBe(0);
    expect(report.schemaVersion).toBe("np.runbook.v1");
    expect(report.ok).toBe(true);
    expect(report.evidence[0]).toEqual(
      expect.objectContaining({
        command: "pnpm --silent run ops:jobs -- --json",
        exitCode: 0,
        ok: true,
        status: "ready",
      }),
    );
    expect(artifact).toEqual(report);
  }, 15_000);

  it("keeps a blocked runbook artifact when evidence exits non-zero after JSON output", async () => {
    const dir = await createRunbookProject(`
console.log(JSON.stringify({
  schemaVersion: "np.ops-jobs.v1",
  ok: true,
  status: "ready",
  summary: { failed: 0, retry: 0, created: 0, active: 0 }
}));
console.error("job probe crashed after writing JSON");
process.exit(3);
`);
    const outPath = join(dir, ".nexpress/runbooks/worker.json");

    const run = await runRunbookCli(dir, ["worker-not-draining", "--json", "--out", outPath]);
    const report = JSON.parse(run.stdout) as {
      ok: boolean;
      status: string;
      evidence: Array<{ exitCode: number; ok: boolean; status: string; error: string }>;
    };
    const artifact = JSON.parse(await readFile(outPath, "utf8")) as typeof report;

    expect(run.exitCode).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.status).toBe("blocked");
    expect(report.evidence[0]).toEqual(
      expect.objectContaining({
        command: "pnpm --silent run ops:jobs -- --json",
        exitCode: 3,
        ok: false,
        status: "blocked",
        error: "job probe crashed after writing JSON",
      }),
    );
    expect(artifact).toEqual(report);
  }, 15_000);
});

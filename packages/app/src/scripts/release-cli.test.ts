import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "../..");
const releaseScript = resolve(scriptDir, "release.ts");

function runReleaseCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", releaseScript, ...args], {
      cwd: packageRoot,
      env: { ...process.env, ...env },
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

function validReleasePlan(command: string): object {
  return {
    schemaVersion: "np.release-plan.v1",
    ok: true,
    planId: "release-cli-test",
    createdAt: "2026-06-10T00:00:00.000Z",
    target: "docker",
    status: "ready",
    summary: {
      commands: 1,
      remediationCommands: 0,
      releaseCommands: 0,
      verifyCommands: 1,
    },
    apply: {
      allowed: true,
      requiresApproval: true,
      blockedReason: null,
      nextCommand: "nexpress release apply --plan /tmp/release-cli-test.json",
      projectNextCommand: "pnpm run ops:release -- apply --plan /tmp/release-cli-test.json",
    },
    audit: { artifactPath: "/tmp/release-cli-test.json" },
    commands: [
      {
        phase: "verify",
        command,
        projectCommand: "pnpm run ops:release -- verify --json",
        required: true,
        requiresApproval: false,
      },
    ],
    check: {
      schemaVersion: "np.release.v1",
      ok: true,
      mode: "check",
      target: "docker",
      url: null,
      status: "ready",
      summary: { steps: 0, ready: 0, attention: 0, blocked: 0 },
      nextCommand: null,
      steps: [],
    },
  };
}

describe("release CLI", () => {
  it("rejects release plan artifacts missing required top-level fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-release-cli-"));
    const planPath = join(dir, "plan.json");
    const outPath = join(dir, "apply.json");
    const plan = validReleasePlan("nexpress release verify --json");
    delete (plan as { audit?: unknown }).audit;
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    const run = await runReleaseCli([
      "apply",
      "--plan",
      planPath,
      "--out",
      outPath,
      "--execute",
      "--approve",
      "release-cli-test",
      "--json",
    ]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("Invalid release plan artifact");
  });

  it("executes release apply commands through structured argv specs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-release-cli-"));
    const binDir = join(dir, "bin");
    const argvPath = join(dir, "argv.json");
    const planPath = join(dir, "plan.json");
    const outPath = join(dir, "apply.json");
    await mkdir(binDir);
    const fakeNexpress = join(binDir, "nexpress");
    await writeFile(
      fakeNexpress,
      [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.NP_TEST_ARGV_FILE, JSON.stringify(process.argv.slice(2)));",
        "process.exit(0);",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeNexpress, 0o755);
    await writeFile(
      planPath,
      `${JSON.stringify(validReleasePlan("nexpress release verify --json"), null, 2)}\n`,
      "utf8",
    );

    const run = await runReleaseCli(
      [
        "apply",
        "--plan",
        planPath,
        "--out",
        outPath,
        "--execute",
        "--approve",
        "release-cli-test",
        "--json",
      ],
      {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        NP_TEST_ARGV_FILE: argvPath,
      },
    );
    const apply = JSON.parse(run.stdout) as { ok: boolean; commands: Array<{ status: string }> };
    const argv = JSON.parse(await readFile(argvPath, "utf8")) as string[];

    expect(run.exitCode).toBe(0);
    expect(apply.ok).toBe(true);
    expect(apply.commands[0]?.status).toBe("success");
    expect(argv).toEqual(["release", "verify", "--json"]);
  });
});

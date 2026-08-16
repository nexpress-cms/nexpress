import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeFeedbackDoctorOutput,
  buildFeedbackReport,
  NEXPRESS_FEEDBACK_URL,
  renderFeedbackReportMarkdown,
} from "./feedback-report.js";

const temporaryDirectories: string[] = [];

async function temporaryProject(project: Record<string, unknown>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "nexpress-feedback-"));
  temporaryDirectories.push(cwd);
  await writeFile(resolve(cwd, "package.json"), JSON.stringify(project), "utf8");
  return cwd;
}

async function installPackage(
  cwd: string,
  name: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const [scope, packageName] = name.split("/");
  const directory = resolve(cwd, "node_modules", scope ?? "", packageName ?? "");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "package.json"), JSON.stringify(manifest), "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("feedback report", () => {
  it("projects only whitelisted local fields and drops hostile Doctor text", async () => {
    const secret = "postgres://private-user:super-secret@example.internal/nexpress";
    const cwd = await temporaryProject({
      name: "private-project-name",
      description: secret,
      packageManager: "pnpm@10.33.0",
      scripts: { doctor: "tsx scripts/doctor.ts", leak: secret },
      dependencies: {
        "@nexpress/core": "^0.4.3",
        "@nexpress/private-customer-name": "1.2.3",
        unrelated: secret,
      },
      devDependencies: { "@nexpress/cli": "^0.4.3" },
    });
    await installPackage(cwd, "@nexpress/core", {
      name: "@nexpress/core",
      version: "0.4.3",
      description: secret,
    });
    await installPackage(cwd, "@nexpress/cli", {
      name: "@nexpress/cli",
      version: "0.4.3",
      repository: secret,
    });
    await installPackage(cwd, "@nexpress/private-customer-name", {
      name: "@nexpress/private-customer-name",
      version: "1.2.3",
    });

    const report = await buildFeedbackReport({
      cwd,
      packageManager: "pnpm",
      runtime: {
        nodeVersion: "v22.18.0",
        platform: "linux",
        arch: "x64",
        captureDoctor: (manager, captureCwd) => {
          expect(manager).toBe("pnpm");
          expect(captureCwd).toBe(cwd);
          return Promise.resolve({
            kind: "output",
            stdout: JSON.stringify({
              schemaVersion: "np.doctor.v1",
              secret,
              checks: [
                {
                  id: "database.reachable",
                  state: "error",
                  label: secret,
                  detail: secret,
                  hint: secret,
                },
                { id: "node.version", state: "ok", label: secret },
                { id: "storage.contract", state: "warn", detail: secret },
              ],
            }),
          });
        },
      },
    });

    expect(report).toEqual({
      schemaVersion: "np.feedback-report.v1",
      environment: {
        node: "v22.18.0",
        platform: "linux",
        arch: "x64",
        packageManager: "pnpm@10.33.0",
      },
      packages: [
        { name: "@nexpress/cli", version: "0.4.3" },
        { name: "@nexpress/core", version: "0.4.3" },
      ],
      doctor: {
        status: "collected",
        summary: { total: 3, warnings: 1, errors: 1 },
        checks: [
          { id: "database.reachable", state: "error" },
          { id: "node.version", state: "ok" },
          { id: "storage.contract", state: "warn" },
        ],
      },
      issueUrl: NEXPRESS_FEEDBACK_URL,
    });
    const serialized = JSON.stringify(report);
    const markdown = renderFeedbackReportMarkdown(report);
    for (const output of [serialized, markdown]) {
      expect(output).not.toContain(secret);
      expect(output).not.toContain(cwd);
      expect(output).not.toContain("private-project-name");
      expect(output).toContain("database.reachable");
      expect(output).toContain(NEXPRESS_FEEDBACK_URL);
    }
    expect(markdown).toContain("was generated locally and was not uploaded");
    expect(markdown).toContain("omits raw environment-variable values");
  });

  it("does not run Doctor when the project has no Doctor script", async () => {
    const cwd = await temporaryProject({
      packageManager: "npm@11.0.0",
      dependencies: { "@nexpress/core": "^0.4.3" },
    });
    let calls = 0;
    const report = await buildFeedbackReport({
      cwd,
      packageManager: "npm",
      runtime: {
        captureDoctor: () => {
          calls += 1;
          return Promise.resolve({ kind: "unavailable" });
        },
      },
    });

    expect(calls).toBe(0);
    expect(report.doctor).toEqual({ status: "unavailable", summary: null, checks: [] });
    expect(report.packages).toEqual([]);
  });

  it("fails the Doctor projection closed for malformed, duplicate, or oversized input", () => {
    const malformedReports = [
      "not JSON",
      JSON.stringify({ schemaVersion: "other", checks: [] }),
      JSON.stringify({
        schemaVersion: "np.doctor.v1",
        checks: [
          { id: "node.version", state: "ok" },
          { id: "node.version", state: "error" },
        ],
      }),
      JSON.stringify({
        schemaVersion: "np.doctor.v1",
        checks: [{ id: "unsafe id", state: "ok" }],
      }),
      JSON.stringify({
        schemaVersion: "np.doctor.v1",
        checks: [{ id: "customer.jane_doe", state: "ok" }],
      }),
      " ".repeat(512 * 1024 + 1),
    ];

    for (const input of malformedReports) {
      expect(analyzeFeedbackDoctorOutput(input)).toEqual({
        status: "invalid",
        summary: null,
        checks: [],
      });
    }
  });

  it("omits malformed or mismatched installed package metadata", async () => {
    const cwd = await temporaryProject({
      packageManager: "pnpm@private-secret",
      scripts: {},
      dependencies: {
        "@nexpress/core": "^0.4.3",
        "@nexpress/editor": "^0.4.3",
      },
    });
    await installPackage(cwd, "@nexpress/core", {
      name: "@nexpress/not-core",
      version: "0.4.3",
    });
    await installPackage(cwd, "@nexpress/editor", {
      name: "@nexpress/editor",
      version: "workspace:*",
    });

    const report = await buildFeedbackReport({ cwd, packageManager: "pnpm" });
    expect(report.packages).toEqual([]);
    expect(report.environment.packageManager).toBe("pnpm");
    expect(JSON.stringify(report)).not.toContain("private-secret");
  });

  it("closes injected runtime identifiers to public Node values", async () => {
    const cwd = await temporaryProject({ scripts: {} });
    const report = await buildFeedbackReport({
      cwd,
      packageManager: "npm",
      runtime: {
        nodeVersion: "secret-node-build",
        platform: "customer-platform",
        arch: "private-architecture",
      },
    });

    expect(report.environment).toMatchObject({
      node: "unknown",
      platform: "unknown",
      arch: "unknown",
    });
  });
});

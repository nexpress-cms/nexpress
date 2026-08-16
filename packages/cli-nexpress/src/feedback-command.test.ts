import { describe, expect, it, vi } from "vitest";

import { NEXPRESS_FEEDBACK_URL, type NpFeedbackReport } from "./feedback-report.js";
import { runNexpressCli } from "./index.js";

const report: NpFeedbackReport = {
  schemaVersion: "np.feedback-report.v1",
  environment: {
    node: "v22.18.0",
    platform: "linux",
    arch: "x64",
    packageManager: "pnpm@10.33.0",
  },
  packages: [{ name: "@nexpress/core", version: "0.4.3" }],
  doctor: {
    status: "collected",
    summary: { total: 1, warnings: 0, errors: 0 },
    checks: [{ id: "node.version", state: "ok" }],
  },
  issueUrl: NEXPRESS_FEEDBACK_URL,
};

async function captureOutput(
  argv: string[],
): Promise<{ buildCalls: number; code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  let buildCalls = 0;
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    const code = await runNexpressCli(["node", "nexpress", ...argv], {
      cwd: "/private/project/path",
      buildFeedbackReport: ({ cwd, packageManager }) => {
        buildCalls += 1;
        expect(cwd).toBe("/private/project/path");
        expect(packageManager).toBe("npm");
        return Promise.resolve(report);
      },
    });
    return { buildCalls, code, stdout, stderr };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

describe("nexpress feedback", () => {
  it("prints Markdown by default without uploading", async () => {
    const result = await captureOutput(["feedback"]);
    expect(result.code).toBe(0);
    expect(result.buildCalls).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("# NexPress feedback report");
    expect(result.stdout).toContain("was generated locally and was not uploaded");
    expect(result.stdout).toContain(NEXPRESS_FEEDBACK_URL);
  });

  it("prints the stable report envelope as JSON", async () => {
    const result = await captureOutput(["feedback", "--json"]);
    expect(result.code).toBe(0);
    expect(result.buildCalls).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(report);
  });

  it("rejects unknown or repeated flags before report collection", async () => {
    for (const argv of [
      ["feedback", "--upload"],
      ["feedback", "--json", "--json"],
    ]) {
      const result = await captureOutput(argv);
      expect(result.code).toBe(2);
      expect(result.buildCalls).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage: nexpress feedback [--json]");
    }
  });

  it("documents the local-only behavior in command help", async () => {
    const result = await captureOutput(["feedback", "--help"]);
    expect(result.code).toBe(0);
    expect(result.buildCalls).toBe(0);
    expect(result.stdout).toContain("Nothing is uploaded automatically");
  });
});

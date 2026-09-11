import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNexpressCli } from "./index.js";

const directories: string[] = [];
async function project(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nexpress-runtime-cli-"));
  directories.push(directory);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, scripts: { "agent:runtime": "node runtime.mjs" } }),
  );
  await writeFile(join(directory, "package-lock.json"), "{}");
  await writeFile(join(directory, "runtime.mjs"), source);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
const status = {
  schemaVersion: "np.agent-runtime-ops.v1",
  operation: "status",
  outcome: "status",
  errorCode: null,
  status: {
    schemaVersion: "np.agent-runtime-status.v1",
    siteId: "default",
    revision: 1,
    enabled: false,
    paused: false,
    readiness: {
      doctor: "unavailable",
      policy: "unavailable",
      budget: "unavailable",
      vault: "unavailable",
      integrityKey: "unavailable",
      worker: "unavailable",
    },
    generatedAt: "2026-09-11T00:00:00.000Z",
  },
  plan: null,
};

describe("nexpress agent runtime wrapper", () => {
  it("reuses the existing project script runner with unchanged explicit arguments", async () => {
    const cwd = await project("");
    const runProjectScript = vi.fn(() => Promise.resolve(undefined));
    const args = ["pause", "--site", "default", "--reason", "Containment", "--execute", "--json"];
    expect(
      await runNexpressCli(["node", "nexpress", "agent", "runtime", ...args], {
        cwd,
        runProjectScript,
      }),
    ).toBe(0);
    expect(runProjectScript).toHaveBeenCalledWith("npm", "agent:runtime", args, cwd);
  });

  it("prints one exact shared JSON result and contains child stderr", async () => {
    const cwd = await project(
      `process.stderr.write("private-bootstrap-marker\\n"); process.stdout.write(${JSON.stringify(`${JSON.stringify(status)}\n`)});`,
    );
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(
      await runNexpressCli(
        ["node", "nexpress", "agent", "runtime", "status", "--site", "default", "--json"],
        { cwd },
      ),
    ).toBe(0);
    expect(JSON.parse(output)).toEqual(status);
    expect(output).not.toContain("private-bootstrap-marker");
  });

  it.each([
    'process.stdout.write("private-child-error-marker"); process.exitCode=1;',
    'process.stdout.write("x".repeat(40_000));',
    `process.stdout.write(${JSON.stringify(`${JSON.stringify({ ...status, rawCredential: "private-child-error-marker" })}\n`)});`,
    `process.stdout.write(${JSON.stringify(`${JSON.stringify({ ...status, operation: "pause", outcome: "paused", status: { ...status.status, paused: true } })}\n`)});`,
    `process.stdout.write(${JSON.stringify(`${JSON.stringify({ ...status, status: { ...status.status, siteId: "other" } })}\n`)});`,
  ])("closes malformed, oversized and private output to one safe result", async (source) => {
    const cwd = await project(source);
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(
      await runNexpressCli(
        ["node", "nexpress", "agent", "runtime", "status", "--site", "default", "--json"],
        { cwd },
      ),
    ).toBe(1);
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: "np.agent-runtime-ops.v1",
      outcome: "blocked",
      errorCode: "RUNTIME_UNAVAILABLE",
      status: null,
      plan: null,
    });
    expect(output).not.toContain("private-child-error-marker");
    expect(output.length).toBeLessThan(512);
  });
});

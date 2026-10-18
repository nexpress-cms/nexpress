import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNexpressCli } from "./index.js";
const directories: string[] = [];
async function project(source: string) {
  const path = await mkdtemp(join(tmpdir(), "np-guardian-cli-"));
  directories.push(path);
  await writeFile(
    join(path, "package.json"),
    JSON.stringify({ private: true, scripts: { "agent:guardian": "node guardian.mjs" } }),
  );
  await writeFile(join(path, "guardian.mjs"), source);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
const status = {
  schemaVersion: "np.agent-guardian-control-ops.v1",
  operation: "status",
  outcome: "status",
  errorCode: null,
  status: {
    schemaVersion: "np.agent-guardian-control-status.v1",
    siteId: "default",
    configured: false,
    revision: 0,
    capture: "unavailable",
    registration: { state: "unavailable", sourceCount: null, readiness: "unavailable" },
    response: "separate-policy-required",
    generatedAt: "2026-10-18T00:00:00.000Z",
  },
  plan: null,
};
describe("nexpress Guardian local wrapper", () => {
  it("passes explicit arguments unchanged through the existing project runner", async () => {
    const cwd = await project(""),
      runProjectScript = vi.fn(async () => {}),
      args = ["disable", "--site", "default", "--reason", "Contain capture", "--execute", "--json"];
    expect(
      await runNexpressCli(["node", "nexpress", "agent", "guardian", ...args], {
        cwd,
        runProjectScript,
      }),
    ).toBe(0);
    expect(runProjectScript).toHaveBeenCalledWith("npm", "agent:guardian", args, cwd);
  });
  it("prints one strict result while containing child bootstrap stderr", async () => {
    const cwd = await project(
      `process.stderr.write("private-bootstrap-marker");process.stdout.write(${JSON.stringify(`${JSON.stringify(status)}\n`)});`,
    );
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(
      await runNexpressCli(
        ["node", "nexpress", "agent", "guardian", "status", "--site", "default", "--json"],
        { cwd },
      ),
    ).toBe(0);
    expect(JSON.parse(output)).toEqual(status);
    expect(output).not.toContain("private-bootstrap");
  });
  it("keeps brief output closed to validated operation/outcome metadata", async () => {
    const cwd = await project(
      `process.stderr.write("private-bootstrap-marker");process.stdout.write(${JSON.stringify(`${JSON.stringify(status)}\n`)});`,
    );
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(
      await runNexpressCli(
        ["node", "nexpress", "agent", "guardian", "status", "--site", "default"],
        { cwd },
      ),
    ).toBe(0);
    expect(output).toBe("Agent guardian status: status\n");
  });
  it.each([
    'process.stdout.write("private-child-marker");process.exitCode=1;',
    'process.stdout.write("x".repeat(40000));',
    `process.stdout.write(${JSON.stringify(`${JSON.stringify({ ...status, sourceMac: "private-child-marker" })}\n`)});`,
    `process.stdout.write(${JSON.stringify(`${JSON.stringify({ ...status, status: { ...status.status, siteId: "other" } })}\n`)});`,
    `process.stdout.write(${JSON.stringify(`${JSON.stringify({ ...status, operation: "disable", outcome: "disabled", status: { ...status.status, configured: true, revision: 1, capture: "disabled" } })}\n`)});`,
  ])("contains malformed, oversized or misbound child output", async (source) => {
    const cwd = await project(source);
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(
      await runNexpressCli(
        ["node", "nexpress", "agent", "guardian", "status", "--site", "default", "--json"],
        { cwd },
      ),
    ).toBe(1);
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: "np.agent-guardian-control-ops.v1",
      operation: "status",
      outcome: "blocked",
      errorCode: "GUARDIAN_UNAVAILABLE",
      status: null,
      plan: null,
    });
    expect(output).not.toContain("private-child");
    expect(output.length).toBeLessThan(512);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runAgentEvaluationV1,
  npCreateAgentOperatorEvaluationSuiteV1,
} from "@nexpress/core/agents";
import { runNexpressCli } from "./index.js";

const directories: string[] = [];
async function project(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nexpress-evaluate-cli-"));
  directories.push(directory);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, scripts: { "agent:evaluate": "node evaluate.mjs" } }),
  );
  await writeFile(join(directory, "package-lock.json"), "{}");
  await writeFile(join(directory, "evaluate.mjs"), source);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
const unavailable = {
  schemaVersion: "np.agent-eval-command.v1",
  artifact: null,
  comparison: null,
  errorCode: "PROVIDER_UNAVAILABLE",
};
describe("nexpress agent evaluate wrapper", () => {
  it("passes explicit evaluation arguments through the existing project script boundary", async () => {
    const cwd = await project("");
    const runProjectScript = vi.fn(() => Promise.resolve(undefined));
    const args = ["--provider", "fake", "--dataset", "operator.v1", "--json"];
    expect(
      await runNexpressCli(["node", "nexpress", "agent", "evaluate", ...args], {
        cwd,
        runProjectScript,
      }),
    ).toBe(0);
    expect(runProjectScript).toHaveBeenCalledWith("npm", "agent:evaluate", args, cwd);
  });
  it("accepts the installed fake suite while rejecting a result from different requested budgets", async () => {
    const artifact = await runAgentEvaluationV1({
      suite: await npCreateAgentOperatorEvaluationSuiteV1(),
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget: {
        maxCalls: 100,
        maxInputTokens: 100000,
        maxOutputTokens: 100000,
        maxCostMicros: 0,
        timeoutMs: 5000,
      },
    });
    const result = {
      schemaVersion: "np.agent-eval-command.v1",
      artifact,
      comparison: null,
      errorCode: null,
    };
    const cwd = await project(`process.stdout.write(${JSON.stringify(JSON.stringify(result))});`);
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(await runNexpressCli(["node", "nexpress", "agent", "evaluate", "--json"], { cwd })).toBe(
      0,
    );
    expect(JSON.parse(output)).toEqual(result);
    output = "";
    expect(
      await runNexpressCli(
        ["node", "nexpress", "agent", "evaluate", "--json", "--max-calls", "99"],
        { cwd },
      ),
    ).toBe(1);
    expect(JSON.parse(output).errorCode).toBe("EVALUATION_UNAVAILABLE");
  });

  it("rejects incomplete paid-run flags before starting a project script", async () => {
    const cwd = await project('throw new Error("must-not-run-private-marker");');
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(
      await runNexpressCli(
        ["node", "nexpress", "agent", "evaluate", "--provider", "paid", "--json"],
        { cwd },
      ),
    ).toBe(1);
    expect(JSON.parse(output).errorCode).toBe("ARGUMENT_INVALID");
  });

  it("accepts one validated safe failure and suppresses child stderr", async () => {
    const cwd = await project(
      `process.stderr.write("private-credential-marker"); process.stdout.write(${JSON.stringify(JSON.stringify(unavailable))}); process.exitCode=1;`,
    );
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(await runNexpressCli(["node", "nexpress", "agent", "evaluate", "--json"], { cwd })).toBe(
      1,
    );
    expect(JSON.parse(output)).toEqual(unavailable);
    expect(output).not.toContain("private-credential-marker");
  });
  it.each([true, false])("rejects raw child output in JSON or text mode (%s)", async (json) => {
    const cwd = await project(
      'process.stdout.write("private-child-marker"); process.stderr.write("private-stderr-marker"); process.exitCode=1;',
    );
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    expect(
      await runNexpressCli(["node", "nexpress", "agent", "evaluate", ...(json ? ["--json"] : [])], {
        cwd,
      }),
    ).toBe(1);
    expect(output).not.toContain("private-");
    expect(output).toContain("EVALUATION_UNAVAILABLE");
  });
});

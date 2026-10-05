import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runAgentEvaluationV1,
  npCreateAgentOperatorEvaluationSuiteV1,
  npCreateAgentPublisherEvaluationSuiteV1,
} from "@nexpress/core/agents";
import {
  npBuildAgentEvaluationReviewArtifactV1,
  npCompareAgentEvaluationReviewArtifactsV1,
  type NpAgentEvaluationArtifactV1,
} from "@nexpress/core/agent-contract";
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
async function publisherArtifact() {
  return runAgentEvaluationV1({
    suite: await npCreateAgentPublisherEvaluationSuiteV1(),
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
}
function captureOutput() {
  let value = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    value += String(chunk);
    return true;
  });
  return {
    read: () => value,
    reset: () => {
      value = "";
    },
  };
}
async function emitFixture(cwd: string, result: unknown, exit = 0) {
  await writeFile(
    join(cwd, "evaluate.mjs"),
    `process.stderr.write("private-child-secret");process.stdout.write(${JSON.stringify(JSON.stringify(result))});process.exitCode=${exit};`,
  );
}
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
  it("accepts Publisher and rejects a suite or budget different from the request", async () => {
    const artifact = await publisherArtifact();
    const cwd = await project("");
    await emitFixture(cwd, {
      schemaVersion: "np.agent-eval-command.v1",
      artifact,
      comparison: null,
      errorCode: null,
    });
    const output = captureOutput();
    const command = ["node", "nexpress", "agent", "evaluate", "--json"];
    expect(await runNexpressCli([...command, "--dataset", "publisher.v1"], { cwd })).toBe(0);
    expect(JSON.parse(output.read()).artifact.suiteHash).toBe(artifact.suiteHash);
    for (const args of [[], ["--dataset", "publisher.v1", "--max-calls", "99"]]) {
      output.reset();
      expect(await runNexpressCli([...command, ...args], { cwd })).toBe(1);
      expect(JSON.parse(output.read()).errorCode).toBe("EVALUATION_UNAVAILABLE");
      expect(output.read()).not.toContain("private-");
    }
  });
  it("binds review results to requested source, labels and comparison before child execution", async () => {
    const source = await publisherArtifact();
    const template = await npBuildAgentEvaluationReviewArtifactV1(source);
    const entry = template.entries.find((e) => e.eligible)!;
    const labels = [
      {
        caseId: entry.caseId,
        caseHash: entry.caseHash,
        predictionHash: entry.predictionHash,
        sourceHash: entry.sourceHash,
        outcome: "accept",
        reviewer: "local",
        reviewedAt: "2026-10-05T12:00:00.000Z",
        notes: "",
        editedProposal: null,
      },
    ];
    const artifact = await npBuildAgentEvaluationReviewArtifactV1(source, labels);
    const comparison = await npCompareAgentEvaluationReviewArtifactsV1(artifact, artifact);
    const result = {
      schemaVersion: "np.agent-eval-review-command.v1",
      artifact,
      comparison,
      errorCode: null,
    };
    const cwd = await project("");
    await writeFile(join(cwd, "source.json"), JSON.stringify(source));
    await writeFile(join(cwd, "labels.json"), JSON.stringify(labels));
    await writeFile(join(cwd, "baseline.json"), JSON.stringify(artifact));
    const output = captureOutput();
    const command = [
      "node",
      "nexpress",
      "agent",
      "evaluate",
      "--review",
      "source.json",
      "--reviews",
      "labels.json",
      "--compare",
      "baseline.json",
      "--json",
    ];
    await emitFixture(cwd, result);
    expect(await runNexpressCli(command, { cwd })).toBe(0);
    expect(JSON.parse(output.read())).toEqual(result);
    const sourceChanged: NpAgentEvaluationArtifactV1 = {
      ...source,
      startedAt: "2026-10-05T00:00:00.000Z",
      finishedAt: "2026-10-05T00:00:01.000Z",
    };
    const otherArtifact = await npBuildAgentEvaluationReviewArtifactV1(sourceChanged);
    for (const wrong of [
      { ...result, artifact: { ...artifact, summary: { ...artifact.summary, accepted: 99 } } },
      { ...result, artifact: template },
      { ...result, comparison: null },
      { ...result, artifact: otherArtifact },
    ]) {
      output.reset();
      await emitFixture(cwd, wrong);
      expect(await runNexpressCli(command, { cwd })).toBe(1);
      expect(JSON.parse(output.read()).errorCode).toBe("EVALUATION_UNAVAILABLE");
    }
    output.reset();
    await emitFixture(cwd, result, 1);
    expect(await runNexpressCli(command, { cwd })).toBe(1);
    expect(JSON.parse(output.read()).errorCode).toBe("EVALUATION_UNAVAILABLE");
    expect(output.read()).not.toContain("private-");
  }, 20_000);
  it("accepts only closed review safe errors and rejects source-output alias before launching child", async () => {
    const source = await publisherArtifact();
    const cwd = await project("");
    await writeFile(join(cwd, "source.json"), JSON.stringify(source));
    const output = captureOutput();
    const command = ["node", "nexpress", "agent", "evaluate", "--review", "source.json", "--json"];
    const safe = {
      schemaVersion: "np.agent-eval-review-command.v1",
      artifact: null,
      comparison: null,
      errorCode: "ARTIFACT_UNAVAILABLE",
    };
    await emitFixture(cwd, safe, 1);
    expect(await runNexpressCli(command, { cwd })).toBe(1);
    expect(JSON.parse(output.read())).toEqual(safe);
    output.reset();
    await emitFixture(cwd, { ...safe, detail: "private-child-secret" }, 1);
    expect(await runNexpressCli(command, { cwd })).toBe(1);
    expect(JSON.parse(output.read()).errorCode).toBe("EVALUATION_UNAVAILABLE");
    output.reset();
    await writeFile(
      join(cwd, "evaluate.mjs"),
      'import {writeFileSync} from "node:fs"; writeFileSync("source.json", "destroyed");',
    );
    expect(await runNexpressCli([...command, "--out", "source.json"], { cwd })).toBe(1);
    expect(JSON.parse(output.read()).errorCode).toBe("ARTIFACT_INVALID");
    expect(JSON.parse(await readFile(join(cwd, "source.json"), "utf8"))).toEqual(source);
    expect(output.read()).not.toContain("private-");
  });
});

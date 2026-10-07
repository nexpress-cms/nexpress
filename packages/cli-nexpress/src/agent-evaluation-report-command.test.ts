import { link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  npBuildAgentEvaluationReportV1,
  npCreateAgentOperatorPlanEvaluationSuiteV1,
  runAgentEvaluationV1,
} from "@nexpress/core/agents";
import {
  npParseAgentEvaluationCommandArgsV1,
  type NpAgentEvaluationReportCommandResultV1,
  type NpAgentEvaluationReportInputV1,
} from "@nexpress/core/agent-contract";
import { prepareEvaluationResultVerifier } from "./agent-evaluate-result.js";
import { runNexpressCli } from "./index.js";

const directories: string[] = [];
const emptyInput: NpAgentEvaluationReportInputV1 = {
  schemaVersion: "np.agent-eval-report-input.v1",
  entries: [],
};
const emptyManifest = { schemaVersion: "np.agent-eval-report-manifest.v1", entries: [] };
const command = ["node", "nexpress", "agent", "evaluate", "--report", "manifest.json", "--json"];
async function project() {
  const cwd = await mkdtemp(join(tmpdir(), "nexpress-evaluation-report-cli-"));
  directories.push(cwd);
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      private: true,
      scripts: { "agent:evaluate": "node evaluate.mjs" },
    }),
  );
  await writeFile(join(cwd, "package-lock.json"), "{}");
  await writeFile(join(cwd, "manifest.json"), JSON.stringify(emptyManifest));
  return cwd;
}
async function emit(cwd: string, result: unknown, exit = 0) {
  await writeFile(
    join(cwd, "evaluate.mjs"),
    `process.stderr.write("private-report-child-marker");process.stdout.write(${JSON.stringify(JSON.stringify(result))});process.exitCode=${exit};`,
  );
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
async function operatorSource() {
  return runAgentEvaluationV1({
    suite: await npCreateAgentOperatorPlanEvaluationSuiteV1(),
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
afterEach(async () => {
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("installed unified evaluation report boundary", () => {
  // Replays a complete source and baseline, then verifies independent child-result binding.
  it("captures manifest and evidence before the child and rejects forged or dropped report evidence", async () => {
    const cwd = await project();
    const source = await operatorSource();
    const evidence = { evaluation: source, review: null };
    const input: NpAgentEvaluationReportInputV1 = {
      schemaVersion: "np.agent-eval-report-input.v1",
      entries: [{ recipe: "operator", current: evidence, baseline: structuredClone(evidence) }],
    };
    const artifact = await npBuildAgentEvaluationReportV1(input);
    const result: NpAgentEvaluationReportCommandResultV1 = {
      schemaVersion: "np.agent-eval-report-command.v1",
      artifact,
      errorCode: null,
    };
    await writeFile(join(cwd, "source.json"), JSON.stringify(source));
    await writeFile(
      join(cwd, "manifest.json"),
      JSON.stringify({
        schemaVersion: emptyManifest.schemaVersion,
        entries: [
          {
            recipe: "operator",
            evaluation: "source.json",
            review: null,
            baseline: { evaluation: "source.json", review: null },
          },
        ],
      }),
    );
    const verify = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1(command.slice(4)),
      cwd,
    );
    const operator = artifact.rows.find((row) => row.recipe === "operator")!;
    expect(operator).toMatchObject({
      status: "present",
      mode: "fake",
      cases: 16,
      evaluationComparison: { status: "compared", result: { comparable: true } },
    });
    await writeFile(join(cwd, "manifest.json"), JSON.stringify(emptyManifest));
    await writeFile(join(cwd, "source.json"), "private-child-overwritten-evidence");
    await expect(verify(result)).resolves.toEqual(result);
    const dropped = await npBuildAgentEvaluationReportV1(emptyInput);
    for (const wrong of [
      { ...result, artifact: { ...artifact, modelUsefulness: "established" } },
      { ...result, artifact: { ...artifact, fullR6: "passed" } },
      {
        ...result,
        artifact: { ...artifact, rows: artifact.rows.filter((row) => row.recipe !== "publisher") },
      },
      {
        ...result,
        artifact: {
          ...artifact,
          rows: artifact.rows.map((row) =>
            row.recipe === "operator" ? { ...row, cases: 99 } : row,
          ),
        },
      },
      {
        ...result,
        artifact: {
          ...artifact,
          rows: artifact.rows.map((row) =>
            row.recipe === "operator"
              ? { ...row, evaluationComparison: { status: "missing-baseline", result: null } }
              : row,
          ),
        },
      },
      { ...result, artifact: dropped },
      { ...result, extra: "private-child-marker" },
    ])
      await expect(async () => verify(wrong)).rejects.toThrow(
        "Mismatched evaluation report result",
      );
  }, 20_000);

  it("accepts a real npm child report with missing evidence but rejects contradictory exit status", async () => {
    const cwd = await project();
    const artifact = await npBuildAgentEvaluationReportV1(emptyInput);
    const result: NpAgentEvaluationReportCommandResultV1 = {
      schemaVersion: "np.agent-eval-report-command.v1",
      artifact,
      errorCode: null,
    };
    const output = captureOutput();
    await emit(cwd, result);
    expect(await runNexpressCli(command, { cwd })).toBe(0);
    expect(JSON.parse(output.read())).toEqual(result);
    expect(artifact.rows.map((row) => row.status)).toEqual(["missing", "missing", "missing"]);
    expect(artifact.fullR6).toBe("not-established");
    expect(artifact.modelUsefulness).toBe("not-established");
    expect(output.read()).not.toContain("private-report-child-marker");
    output.reset();
    await emit(cwd, result, 1);
    expect(await runNexpressCli(command, { cwd })).toBe(1);
    expect(JSON.parse(output.read())).toEqual({
      schemaVersion: result.schemaVersion,
      artifact: null,
      errorCode: "EVALUATION_UNAVAILABLE",
    });
    expect(output.read()).not.toContain("private-report-child-marker");
  }, 20_000);

  it("rejects report input aliases and incompatible flags before starting the project script", async () => {
    const cwd = await project();
    const output = captureOutput();
    const sourceBytes = JSON.stringify(await operatorSource());
    await writeFile(join(cwd, "source.json"), sourceBytes);
    const manifest = {
      schemaVersion: emptyManifest.schemaVersion,
      entries: [{ recipe: "operator", evaluation: "source.json", review: null, baseline: null }],
    };
    await writeFile(join(cwd, "manifest.json"), JSON.stringify(manifest));
    await link(join(cwd, "source.json"), join(cwd, "alias.json"));
    await symlink(join(cwd, "source.json"), join(cwd, "symbolic.json"));
    await writeFile(
      join(cwd, "evaluate.mjs"),
      'import { writeFileSync } from "node:fs";writeFileSync("child-ran", "unexpected");',
    );
    for (const destination of ["manifest.json", "source.json", "alias.json", "symbolic.json"]) {
      output.reset();
      expect(await runNexpressCli([...command, "--out", destination], { cwd })).toBe(1);
      expect(JSON.parse(output.read()).errorCode).toBe("ARTIFACT_INVALID");
    }
    for (const flags of [
      ["--dataset", "operator.v1"],
      ["--review", "source.json"],
      ["--compare", "source.json"],
      ["--confirm-network"],
    ]) {
      output.reset();
      expect(await runNexpressCli([...command, ...flags], { cwd })).toBe(1);
      expect(JSON.parse(output.read()).errorCode).toBe("ARGUMENT_INVALID");
    }
    await expect(readFile(join(cwd, "child-ran"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(cwd, "source.json"), "utf8")).toBe(sourceBytes);
    expect(JSON.parse(await readFile(join(cwd, "manifest.json"), "utf8"))).toEqual(manifest);
  });
});

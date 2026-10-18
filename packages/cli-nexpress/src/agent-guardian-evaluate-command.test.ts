import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runAgentGuardianEvaluationV1 } from "@nexpress/core/agents";
import {
  npBuildAgentGuardianEvaluationReviewArtifactV1,
  npCompareAgentGuardianEvaluationArtifactsV1,
  npCompareAgentGuardianEvaluationReviewArtifactsV1,
  npParseAgentEvaluationCommandArgsV1,
  npRequireAgentGuardianEvaluationArtifactV1,
  npRequireAgentGuardianEvaluationReviewArtifactV1,
  type NpAgentGuardianEvaluationArtifactV1,
} from "@nexpress/core/agent-contract";
import {
  evaluationResultFailed,
  formatEvaluationResult,
  prepareEvaluationResultVerifier,
} from "./agent-evaluate-result.js";
import { runNexpressCli } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "np-guardian-cli-"));
  directories.push(path);
  return path;
}
function capture() {
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  return {
    read: () => output,
    reset: () => {
      output = "";
    },
  };
}
async function appProject(cwd: string) {
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ private: true, scripts: { "agent:evaluate": "node evaluate.mjs" } }),
  );
  await writeFile(join(cwd, "package-lock.json"), "{}");
  // Execute the actual App command source through the repository's TS loader,
  // avoiding a CLI-test dependency on the unrelated App build task's ordering.
  await writeFile(
    join(cwd, "evaluate.mjs"),
    `import {register} from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))};
const unregister=register();
try {
  const {runAgentEvaluateProcessV1}=await import(${JSON.stringify(new URL("../../app/src/scripts/agent-evaluate.ts", import.meta.url).href)});
  process.stderr.write("private-child-marker");
  process.exitCode=await runAgentEvaluateProcessV1({argv:process.argv.slice(2),resolveProvider:()=>{throw new Error("Forbidden provider dispatch");}});
} finally {await unregister();}
`,
  );
}
const args = (values: string[]) => ["node", "nexpress", "agent", "evaluate", ...values];
// Child results cross JSON/stdout; exercise that wire value rather than the
// evaluator's in-memory objects from Vitest's separate module realms.
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
describe("Guardian offline evaluation CLI boundary", () => {
  let artifact: NpAgentGuardianEvaluationArtifactV1;
  beforeAll(async () => {
    artifact = await runAgentGuardianEvaluationV1();
  });

  it("binds evaluation and comparisons to the actual installed synthetic corpus and closed result shape", async () => {
    const cwd = await directory();
    await writeFile(join(cwd, "baseline.json"), JSON.stringify(artifact));
    const verify = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1([
        "--dataset",
        "guardian.v1",
        "--compare",
        "baseline.json",
      ]),
      cwd,
    );
    const result = {
      schemaVersion: "np.agent-guardian-eval-command.v1" as const,
      artifact,
      comparison: await npCompareAgentGuardianEvaluationArtifactsV1(artifact, artifact),
      errorCode: null,
    };
    expect(await verify(wire(result))).toEqual(result);
    expect(evaluationResultFailed(result)).toBe(false);
    expect(artifact.summary.cases).toBe(64);
    expect(formatEvaluationResult(result)).toContain("Production rule replay");
    for (const wrong of [
      { ...result, schemaVersion: "np.agent-eval-command.v1" },
      { ...result, artifact: { ...artifact, enablement: "established" } },
      { ...result, artifact: { ...artifact, summary: { ...artifact.summary, cases: 1 } } },
      { ...result, comparison: null },
      { ...result, rawCredential: "private-marker" },
    ])
      await expect(verify(wire(wrong))).rejects.toThrow("Mismatched Guardian result");
    const failure = {
      schemaVersion: result.schemaVersion,
      artifact: null,
      comparison: null,
      errorCode: "ARTIFACT_UNAVAILABLE" as const,
    };
    expect(await verify(failure)).toEqual(failure);
    expect(evaluationResultFailed(failure)).toBe(true);
    await expect(verify({ ...failure, artifact })).rejects.toThrow();
    expect(evaluationResultFailed({ ...result, artifact: { ...artifact, ok: false } })).toBe(true);
  });

  it("binds reviews to the requested source, exact labels and matched prior review without granting approval", async () => {
    const cwd = await directory();
    const empty = await npBuildAgentGuardianEvaluationReviewArtifactV1(artifact);
    const entry = empty.entries.find((item) => item.eligible && item.predictionHash);
    if (!entry) throw new Error("Missing actual reviewable Guardian prediction");
    const label = {
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      predictionHash: entry.predictionHash,
      sourceHash: entry.sourceHash,
      outcome: "accept",
      reviewer: "synthetic reviewer",
      reviewedAt: "2026-10-18T00:00:00.000Z",
      notes: "Synthetic prediction support only",
      editedProposal: null,
    };
    await writeFile(join(cwd, "source.json"), JSON.stringify(artifact));
    await writeFile(join(cwd, "labels.json"), JSON.stringify([label]));
    await writeFile(join(cwd, "prior.json"), JSON.stringify(empty));
    const reviewed = await npBuildAgentGuardianEvaluationReviewArtifactV1(artifact, [label]);
    const verify = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1([
        "--review",
        "source.json",
        "--reviews",
        "labels.json",
        "--compare",
        "prior.json",
      ]),
      cwd,
    );
    const result = {
      schemaVersion: "np.agent-guardian-eval-review-command.v1" as const,
      artifact: reviewed,
      comparison: await npCompareAgentGuardianEvaluationReviewArtifactsV1(reviewed, empty),
      errorCode: null,
    };
    expect(await verify(wire(result))).toEqual(result);
    expect(formatEvaluationResult(result)).toContain(
      "Self-reported labels confer no approval authority",
    );
    const changed = await npBuildAgentGuardianEvaluationReviewArtifactV1(artifact, [
      { ...label, reviewer: "different reviewer" },
    ]);
    for (const wrong of [
      { ...result, artifact: empty },
      { ...result, artifact: changed },
      { ...result, comparison: null },
      { ...result, approvalToken: "forged" },
    ])
      await expect(verify(wire(wrong))).rejects.toThrow();
    await writeFile(
      join(cwd, "labels.json"),
      JSON.stringify([{ ...label, sourceHash: label.caseHash }]),
    );
    await expect(
      prepareEvaluationResultVerifier(
        npParseAgentEvaluationCommandArgsV1([
          "--review",
          "source.json",
          "--reviews",
          "labels.json",
        ]),
        cwd,
      ),
    ).rejects.toThrow();
  });

  it("rejects output aliases of source or comparison artifacts before child execution", async () => {
    const cwd = await directory();
    await writeFile(join(cwd, "source.json"), JSON.stringify(artifact));
    await link(join(cwd, "source.json"), join(cwd, "alias.json"));
    for (const values of [
      ["--review", "source.json", "--out", "alias.json"],
      ["--dataset", "guardian.v1", "--compare", "source.json", "--out", "source.json"],
    ])
      await expect(
        prepareEvaluationResultVerifier(npParseAgentEvaluationCommandArgsV1(values), cwd),
      ).rejects.toThrow("Invalid review output");
  });

  it("carries actual App evaluation, artifacts, comparisons and reviews through the real project-script boundary", async () => {
    const cwd = await directory();
    await appProject(cwd);
    const output = capture();
    const run = async (values: string[]) => {
      output.reset();
      const code = await runNexpressCli(args([...values, "--json"]), { cwd });
      expect(output.read()).not.toContain("private-child-marker");
      return { code, value: JSON.parse(output.read()) as unknown };
    };
    const first = await run(["--dataset", "guardian.v1", "--out", "source.json"]);
    expect(first.code).toBe(0);
    expect(first.value).toEqual({
      schemaVersion: "np.agent-guardian-eval-command.v1",
      artifact,
      comparison: null,
      errorCode: null,
    });
    expect(
      await npRequireAgentGuardianEvaluationArtifactV1(
        JSON.parse(await readFile(join(cwd, "source.json"), "utf8")),
      ),
    ).toEqual(artifact);
    const compared = await run(["--dataset", "guardian.v1", "--compare", "source.json"]);
    expect(compared.code).toBe(0);
    expect(compared.value).toMatchObject({
      comparison: { comparable: true, matchedCasesDelta: 0 },
    });
    const review = await run(["--review", "source.json", "--out", "review.json"]);
    expect(review.code).toBe(0);
    const reviewArtifact = await npRequireAgentGuardianEvaluationReviewArtifactV1(
      JSON.parse(await readFile(join(cwd, "review.json"), "utf8")),
    );
    expect(review.value).toMatchObject({
      schemaVersion: "np.agent-guardian-eval-review-command.v1",
      artifact: { authority: "offline-self-reported-no-approval", summary: { unreviewed: 64 } },
    });
    const reviewedComparison = await run(["--review", "source.json", "--compare", "review.json"]);
    expect(reviewedComparison.code).toBe(0);
    expect(reviewedComparison.value).toMatchObject({
      comparison: await npCompareAgentGuardianEvaluationReviewArtifactsV1(
        reviewArtifact,
        reviewArtifact,
      ),
    });
    output.reset();
    expect(await runNexpressCli(args(["--dataset", "guardian.v1"]), { cwd })).toBe(0);
    expect(output.read()).toContain("model usefulness and enablement are not established");
  }, 30_000);

  it("lists Guardian in both help surfaces and rejects effect/provider flags before starting a child", async () => {
    const cwd = await directory();
    await appProject(cwd);
    const output = capture();
    expect(await runNexpressCli(["node", "nexpress", "--help"], { cwd })).toBe(0);
    expect(output.read()).toContain("guardian.v1");
    output.reset();
    expect(await runNexpressCli(args(["--help"]), { cwd })).toBe(0);
    expect(output.read()).toContain("Guardian reviews");
    for (const flags of [
      ["--provider", "paid"],
      ["--model", "deterministic-v1"],
      ["--confirm-network"],
    ]) {
      output.reset();
      expect(
        await runNexpressCli(args(["--dataset", "guardian.v1", ...flags, "--json"]), { cwd }),
      ).toBe(1);
      expect(JSON.parse(output.read())).toMatchObject({
        errorCode: "ARGUMENT_INVALID",
        artifact: null,
      });
    }
  });
});

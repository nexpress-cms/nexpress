import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  runAgentEvaluationV1,
} from "@nexpress/core/agents";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npCompareAgentModeratorProposalEvaluationReviewArtifactsV1,
  npParseAgentEvaluationCommandArgsV1,
  type NpAgentModeratorProposalEvaluationReviewLabelV1,
} from "@nexpress/core/agent-contract";
import {
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
async function fixture() {
  return runAgentEvaluationV1({
    suite: await npCreateAgentModeratorProposalEvaluationSuiteV1(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget: {
      maxCalls: 100,
      maxInputTokens: 100_000,
      maxOutputTokens: 100_000,
      maxCostMicros: 0,
      timeoutMs: 5000,
    },
  });
}
async function directory() {
  const cwd = await mkdtemp(join(tmpdir(), "np-moderator-proposal-cli-"));
  directories.push(cwd);
  return cwd;
}
it("binds Moderator proposal results to the requested installed suite and budget", async () => {
  const cwd = await directory();
  const artifact = await fixture();
  const result = {
    schemaVersion: "np.agent-eval-command.v1",
    artifact,
    comparison: null,
    errorCode: null,
  };
  const verify = await prepareEvaluationResultVerifier(
    npParseAgentEvaluationCommandArgsV1(["--dataset", "moderator-proposal.v1"]),
    cwd,
  );
  expect(await verify(result)).toEqual(result);
  for (const args of [[], ["--dataset", "moderator-proposal.v1", "--max-calls", "99"]]) {
    const other = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1(args),
      cwd,
    );
    await expect(other(result)).rejects.toThrow("Mismatched evaluation result");
  }
  await expect(verify({ ...result, detail: "private-child-marker" })).rejects.toThrow();
}, 20_000);
// Captures inputs independently, then exercises one actual npm child through the CLI boundary.
// The timeout covers repeated bounded hash verification, not product latency.
it("binds Moderator proposal review output to exact source, labels and comparison before child execution", async () => {
  const cwd = await directory();
  const source = await fixture();
  const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source);
  const entry = template.entries.find(
    (e) => e.eligible && e.response?.decision.kind === "complete",
  )!;
  const labels: NpAgentModeratorProposalEvaluationReviewLabelV1[] = [
    {
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      predictionHash: entry.predictionHash,
      sourceHash: entry.sourceHash,
      outcome: "accept",
      reviewer: "local-reviewer",
      reviewedAt: "2026-10-08T00:00:00.000Z",
      notes: "Synthetic abstention review.",
      editedProposal: null,
    },
  ];
  const artifact = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, labels);
  const comparison = await npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(
    artifact,
    artifact,
  );
  const result = {
    schemaVersion: "np.agent-moderator-proposal-eval-review-command.v1",
    artifact,
    comparison,
    errorCode: null,
  };
  await Promise.all([
    writeFile(join(cwd, "source.json"), JSON.stringify(source)),
    writeFile(join(cwd, "labels.json"), JSON.stringify(labels)),
    writeFile(join(cwd, "baseline.json"), JSON.stringify(artifact)),
    writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ private: true, scripts: { "agent:evaluate": "node evaluate.mjs" } }),
    ),
    writeFile(join(cwd, "package-lock.json"), "{}"),
    writeFile(
      join(cwd, "evaluate.mjs"),
      `process.stderr.write("private-child-marker");process.stdout.write(${JSON.stringify(JSON.stringify(result))});`,
    ),
  ]);
  const args = [
    "--review",
    "source.json",
    "--reviews",
    "labels.json",
    "--compare",
    "baseline.json",
    "--json",
  ];
  const verify = await prepareEvaluationResultVerifier(
    npParseAgentEvaluationCommandArgsV1(args),
    cwd,
  );
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  expect(await runNexpressCli(["node", "nexpress", "agent", "evaluate", ...args], { cwd })).toBe(0);
  expect(JSON.parse(output)).toEqual(result);
  expect(formatEvaluationResult(await verify(result))).toContain("1 reviewed");
  expect(output).not.toContain("private-child-marker");

  const changedSource = {
    ...source,
    startedAt: "2026-10-08T01:00:00.000Z",
    finishedAt: "2026-10-08T01:00:01.000Z",
  };
  const otherArtifact =
    await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(changedSource);
  // A child replacing files cannot replace the inputs already captured by the verifier.
  await Promise.all([
    writeFile(join(cwd, "source.json"), JSON.stringify(changedSource)),
    writeFile(join(cwd, "labels.json"), "[]"),
    writeFile(join(cwd, "baseline.json"), JSON.stringify(template)),
  ]);
  expect(await verify(result)).toEqual(result);
  for (const wrong of [
    { ...result, artifact: template },
    { ...result, artifact: otherArtifact },
    { ...result, artifact: { ...artifact, summary: { ...artifact.summary, reviewed: 99 } } },
    { ...result, comparison: null },
    { ...result, comparison: { ...comparison, acceptBasisPointsDelta: 10_000 } },
    { ...result, detail: "private-child-marker" },
  ])
    await expect(verify(wrong)).rejects.toThrow("Mismatched Moderator proposal review result");
}, 20_000);

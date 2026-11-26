import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  runAgentModeratorEvaluationV1,
  runAgentModeratorEvaluationV2,
  runAgentModeratorEvaluationV3,
  npBuildAgentModeratorEvaluationReviewArtifact,
  npCompareAgentModeratorEvaluationArtifacts,
  npCompareAgentModeratorEvaluationReviewArtifacts,
  npBuildAgentModeratorEvaluationReviewArtifactV1,
} from "@nexpress/core/agents";
import { npParseAgentEvaluationCommandArgsV1 } from "@nexpress/core/agent-contract";
import { prepareEvaluationResultVerifier } from "./agent-evaluate-result.js";
import { runNexpressCli } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
// Replays the actual 22-case detector repeatedly to verify independent artifact binding.
it("independently binds Moderator detector and review results to requested inputs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "np-moderator-cli-"));
  directories.push(cwd);
  const artifact = await runAgentModeratorEvaluationV1();
  const result = {
    schemaVersion: "np.agent-moderator-eval-command.v1",
    artifact,
    comparison: null,
    errorCode: null,
  };
  const verify = await prepareEvaluationResultVerifier(
    npParseAgentEvaluationCommandArgsV1(["--dataset", "moderator.v1"]),
    cwd,
  );
  expect(await verify(result)).toEqual(result);
  for (const wrong of [
    { ...result, artifact: { ...artifact, ok: false } },
    { ...result, comparison: {} },
    { ...result, detail: "private-secret" },
  ])
    await expect(verify(wrong)).rejects.toThrow();
  await writeFile(join(cwd, "source.json"), JSON.stringify(artifact));
  const review = await npBuildAgentModeratorEvaluationReviewArtifactV1(artifact);
  const verifyReview = await prepareEvaluationResultVerifier(
    npParseAgentEvaluationCommandArgsV1(["--review", "source.json"]),
    cwd,
  );
  const reviewResult = {
    schemaVersion: "np.agent-moderator-eval-review-command.v1",
    artifact: review,
    comparison: null,
    errorCode: null,
  };
  expect(await verifyReview(reviewResult)).toEqual(reviewResult);
  await expect(
    verifyReview({
      ...reviewResult,
      artifact: { ...review, summary: { ...review.summary, reviewed: 99 } },
    }),
  ).rejects.toThrow();
  await expect(
    prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1(["--review", "source.json", "--out", "source.json"]),
      cwd,
    ),
  ).rejects.toThrow();
}, 20_000);
it("carries a real Moderator V3 child result through the installed CLI boundary with closed output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "np-moderator-child-"));
  directories.push(cwd);
  const artifact = await runAgentModeratorEvaluationV3();
  const result = {
    schemaVersion: "np.agent-moderator-eval-command.v3",
    artifact,
    comparison: null,
    errorCode: null,
  };
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ private: true, scripts: { "agent:evaluate": "node evaluate.mjs" } }),
  );
  await writeFile(join(cwd, "package-lock.json"), "{}");
  await writeFile(
    join(cwd, "evaluate.mjs"),
    `process.stderr.write("private-marker");process.stdout.write(${JSON.stringify(JSON.stringify(result))});`,
  );
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  expect(
    await runNexpressCli(
      ["node", "nexpress", "agent", "evaluate", "--dataset", "moderator.v3", "--json"],
      { cwd },
    ),
  ).toBe(0);
  expect(JSON.parse(output)).toEqual(result);
  expect(output).not.toContain("private-marker");
});

it.each(["moderator.v2", "moderator.v3"] as const)(
  "binds %s inputs and exact feedback while rejecting another detector version",
  async (dataset) => {
    const version = dataset === "moderator.v3" ? "v3" : "v2";
    const cwd = await mkdtemp(join(tmpdir(), `np-moderator-${version}-cli-`));
    directories.push(cwd);
    const v1 = await runAgentModeratorEvaluationV1();
    const current =
      dataset === "moderator.v3"
        ? await runAgentModeratorEvaluationV3()
        : await runAgentModeratorEvaluationV2();
    const other =
      dataset === "moderator.v3"
        ? await runAgentModeratorEvaluationV2()
        : await runAgentModeratorEvaluationV3();
    await writeFile(join(cwd, "baseline.json"), JSON.stringify(v1));
    const result = {
      schemaVersion: `np.agent-moderator-eval-command.${version}`,
      artifact: current,
      comparison: await npCompareAgentModeratorEvaluationArtifacts(current, v1),
      errorCode: null,
    };
    const verify = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1(["--dataset", dataset, "--compare", "baseline.json"]),
      cwd,
    );
    expect(await verify(result)).toEqual(result);
    expect(result.comparison).toMatchObject({ comparable: false, reason: "INCOMPATIBLE_SUITE" });
    const failure = {
      schemaVersion: result.schemaVersion,
      artifact: null,
      comparison: null,
      errorCode: "ARTIFACT_UNAVAILABLE",
    };
    expect(await verify(failure)).toEqual(failure);
    await expect(
      verify({ ...failure, schemaVersion: "np.agent-moderator-eval-command.v1" }),
    ).rejects.toThrow("Mismatched Moderator result");
    await expect(verify({ ...result, artifact: v1 })).rejects.toThrow(
      "Mismatched Moderator result",
    );
    await expect(verify({ ...result, artifact: other })).rejects.toThrow(
      "Mismatched Moderator result",
    );
    await expect(
      verify({ ...result, schemaVersion: "np.agent-moderator-eval-command.v1" }),
    ).rejects.toThrow("Mismatched Moderator result");
    await expect(verify({ ...result, comparison: null })).rejects.toThrow(
      "Mismatched Moderator result",
    );
    const verifyV1 = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1(["--dataset", "moderator.v1"]),
      cwd,
    );
    await expect(
      verifyV1({
        ...result,
        schemaVersion: "np.agent-moderator-eval-command.v1",
        comparison: null,
      }),
    ).rejects.toThrow("Mismatched Moderator result");

    const template = await npBuildAgentModeratorEvaluationReviewArtifact(current);
    const entry = template.entries.find((value) => value.eligible)!;
    const labels = [
      {
        caseId: entry.caseId,
        caseHash: entry.caseHash,
        predictionHash: entry.predictionHash,
        sourceHash: entry.sourceHash,
        label: "false-positive",
        reviewer: "offline-local",
        reviewedAt: "2026-10-14T00:00:00.000Z",
        notes: "Synthetic review only.",
      },
    ];
    const artifact = await npBuildAgentModeratorEvaluationReviewArtifact(current, labels);
    const reviewedResult = {
      schemaVersion: `np.agent-moderator-eval-review-command.${version}`,
      artifact,
      comparison: await npCompareAgentModeratorEvaluationReviewArtifacts(artifact, artifact),
      errorCode: null,
    };
    await Promise.all([
      writeFile(join(cwd, "source.json"), JSON.stringify(current)),
      writeFile(join(cwd, "labels.json"), JSON.stringify(labels)),
      writeFile(join(cwd, "review.json"), JSON.stringify(artifact)),
    ]);
    const verifyReview = await prepareEvaluationResultVerifier(
      npParseAgentEvaluationCommandArgsV1([
        "--review",
        "source.json",
        "--reviews",
        "labels.json",
        "--compare",
        "review.json",
      ]),
      cwd,
    );
    expect(await verifyReview(reviewedResult)).toEqual(reviewedResult);
    // Child file mutation cannot replace the source and labels captured before execution.
    await Promise.all([
      writeFile(join(cwd, "source.json"), JSON.stringify(v1)),
      writeFile(join(cwd, "labels.json"), "[]"),
    ]);
    expect(await verifyReview(reviewedResult)).toEqual(reviewedResult);
    for (const wrong of [
      { ...reviewedResult, artifact: template },
      { ...reviewedResult, comparison: null },
      { ...reviewedResult, schemaVersion: "np.agent-moderator-eval-review-command.v1" },
    ])
      await expect(verifyReview(wrong)).rejects.toThrow("Mismatched Moderator result");
  },
  20_000,
);

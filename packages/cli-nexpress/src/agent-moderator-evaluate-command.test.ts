import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  runAgentModeratorEvaluationV1,
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
});
it("carries a real Moderator child result through the installed CLI boundary with closed output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "np-moderator-child-"));
  directories.push(cwd);
  const artifact = await runAgentModeratorEvaluationV1();
  const result = {
    schemaVersion: "np.agent-moderator-eval-command.v1",
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
      ["node", "nexpress", "agent", "evaluate", "--dataset", "moderator.v1", "--json"],
      { cwd },
    ),
  ).toBe(0);
  expect(JSON.parse(output)).toEqual(result);
  expect(output).not.toContain("private-marker");
});

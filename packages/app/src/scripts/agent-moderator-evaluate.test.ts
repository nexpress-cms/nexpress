import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { npRequireAgentModeratorEvaluationArtifactV1 } from "@nexpress/core/agents";
import { runAgentEvaluateProcessV1 } from "./agent-evaluate.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function run(argv: string[]) {
  let output = "";
  const resolveProvider = vi.fn(() => Promise.resolve(null));
  const code = await runAgentEvaluateProcessV1({
    argv: [...argv, "--json"],
    resolveProvider,
    output: {
      write: (chunk: string) => {
        output += chunk;
        return true;
      },
    },
  });
  expect(resolveProvider).not.toHaveBeenCalled();
  return { code, result: JSON.parse(output) };
}
it("runs the actual offline Moderator detector and saves, reviews and compares exact feedback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-moderator-eval-"));
  directories.push(dir);
  const source = join(dir, "source.json"),
    review = join(dir, "review.json"),
    labels = join(dir, "labels.json");
  const evaluated = await run(["--dataset", "moderator.v1", "--out", source]);
  expect(evaluated.code).toBe(0);
  const artifact = await npRequireAgentModeratorEvaluationArtifactV1(
    JSON.parse(await readFile(source, "utf8")),
  );
  expect(artifact.ok).toBe(true);
  expect(artifact.summary.syntheticClassification.falsePositive).toBeGreaterThan(0);
  expect(artifact.summary.syntheticClassification.falseNegative).toBeGreaterThan(0);
  const compared = await run(["--dataset", "moderator.v1", "--compare", source]);
  expect(compared.result.comparison.comparable).toBe(true);
  const template = await run(["--review", source]);
  expect(template.code).toBe(0);
  const entry = template.result.artifact.entries.find((e: { eligible: boolean }) => e.eligible);
  const label = {
    caseId: entry.caseId,
    caseHash: entry.caseHash,
    predictionHash: entry.predictionHash,
    sourceHash: entry.sourceHash,
    label: "false-positive",
    reviewer: "offline-local",
    reviewedAt: "2026-10-06T00:00:00.000Z",
    notes: "Synthetic review only.",
  };
  await writeFile(labels, JSON.stringify([label]));
  const reviewed = await run(["--review", source, "--reviews", labels, "--out", review]);
  expect(reviewed.result.artifact.summary).toMatchObject({ reviewed: 1, falsePositive: 1 });
  expect(reviewed.result.artifact.source.ok).toBe(true);
  const comparison = await run(["--review", source, "--reviews", labels, "--compare", review]);
  expect(comparison.result.comparison).toMatchObject({
    comparable: true,
    falsePositiveBasisPointsDelta: 0,
  });
  const bytes = await readFile(source, "utf8");
  expect((await run(["--review", source, "--out", source])).code).toBe(1);
  expect(
    (await run(["--dataset", "moderator.v1", "--compare", source, "--out", source])).code,
  ).toBe(1);
  expect(await readFile(source, "utf8")).toBe(bytes);
  label.predictionHash = "0".repeat(64);
  await writeFile(labels, JSON.stringify([label]));
  expect((await run(["--review", source, "--reviews", labels])).result.errorCode).toBe(
    "ARTIFACT_INVALID",
  );
});
it("rejects provider, model and budget options for deterministic Moderator before any provider lookup", async () => {
  for (const flags of [
    ["--provider", "network"],
    ["--model", "deterministic-v1"],
    ["--max-calls", "0"],
    ["--confirm-network"],
  ]) {
    expect((await run(["--dataset", "moderator.v1", ...flags])).result.errorCode).toBe(
      "ARGUMENT_INVALID",
    );
  }
});

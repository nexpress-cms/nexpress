import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  npRequireAgentGuardianEvaluationArtifactV1,
  npRequireAgentGuardianEvaluationReviewArtifactV1,
} from "@nexpress/core/agent-contract";
import { runAgentEvaluateProcessV1 } from "./agent-evaluate.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "np-guardian-eval-"));
  directories.push(path);
  return path;
}
async function run(argv: string[]) {
  let output = "";
  const resolveProvider = vi.fn(() =>
    Promise.reject(new Error("Guardian must not resolve a provider")),
  );
  const code = await runAgentEvaluateProcessV1({
    argv,
    resolveProvider,
    output: {
      write: (chunk: string) => {
        output += chunk;
        return true;
      },
    },
  });
  expect(resolveProvider).not.toHaveBeenCalled();
  return { code, output };
}
describe("Guardian local evaluation command", () => {
  it("runs and compares the versioned synthetic corpus without provider dispatch or production claims", async () => {
    const path = join(await directory(), "guardian.json");
    const first = await run(["--dataset", "guardian.v1", "--out", path, "--json"]);
    expect(first.code).toBe(0);
    const artifact = await npRequireAgentGuardianEvaluationArtifactV1(
      JSON.parse(await readFile(path, "utf8")),
    );
    expect(JSON.parse(first.output)).toMatchObject({
      schemaVersion: "np.agent-guardian-eval-command.v1",
      artifact: {
        dataset: "guardian.v1",
        productionRuleReplay: "not-run",
        productionPrecision: "not-established",
        enablement: "not-established",
      },
    });
    const compared = await run(["--dataset", "guardian.v1", "--compare", path, "--json"]);
    expect(JSON.parse(compared.output).comparison).toMatchObject({
      comparable: true,
      matchedCasesDelta: 0,
    });
    const text = await run(["--dataset", "guardian.v1"]);
    expect(text.output).toContain(
      "Production rule replay, production precision, model usefulness and enablement are not established",
    );
    expect(artifact.summary.cases).toBe(64);
    for (const flags of [
      ["--provider", "paid"],
      ["--model", "deterministic-v1"],
      ["--max-cost-micros", "0"],
      ["--confirm-network"],
    ]) {
      const rejected = await run(["--dataset", "guardian.v1", ...flags, "--json"]);
      expect(rejected.code).toBe(1);
      expect(JSON.parse(rejected.output)).toMatchObject({
        artifact: null,
        errorCode: "ARGUMENT_INVALID",
      });
    }
  });
  it("round trips hash-bound review labels and report grouping without granting an approval", async () => {
    const dir = await directory();
    const source = join(dir, "guardian.json"),
      reviewPath = join(dir, "review.json"),
      labelsPath = join(dir, "labels.json");
    await run(["--dataset", "guardian.v1", "--out", source, "--json"]);
    const empty = await run(["--review", source, "--json"]);
    const emptyReview = await npRequireAgentGuardianEvaluationReviewArtifactV1(
      JSON.parse(empty.output).artifact,
    );
    const entry = emptyReview.entries[0];
    const labels = [
      {
        caseId: entry.caseId,
        caseHash: entry.caseHash,
        predictionHash: entry.predictionHash,
        sourceHash: entry.sourceHash,
        outcome: "accept",
        reviewer: "offline reviewer",
        reviewedAt: "2026-10-18T00:00:00.000Z",
        notes: "Synthetic support only",
        editedProposal: null,
      },
    ];
    await writeFile(labelsPath, JSON.stringify(labels));
    const reviewed = await run([
      "--review",
      source,
      "--reviews",
      labelsPath,
      "--out",
      reviewPath,
      "--json",
    ]);
    expect(reviewed.code).toBe(0);
    expect(JSON.parse(reviewed.output)).toMatchObject({
      schemaVersion: "np.agent-guardian-eval-review-command.v1",
      artifact: {
        authority: "offline-self-reported-no-approval",
        summary: { supported: 1, unreviewed: 63 },
      },
    });
    expect(
      await npRequireAgentGuardianEvaluationReviewArtifactV1(
        JSON.parse(await readFile(reviewPath, "utf8")),
      ),
    ).toMatchObject({ labels });
    const manifestPath = join(dir, "report-input.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "np.agent-eval-report-manifest.v1",
        entries: [
          {
            recipe: "guardian",
            evaluation: "guardian.json",
            review: "review.json",
            baseline: null,
          },
        ],
      }),
    );
    const report = await run(["--report", manifestPath, "--json"]);
    expect(report.code).toBe(0);
    expect(JSON.parse(report.output).artifact.rows.at(-1)).toMatchObject({
      recipe: "guardian",
      review: { summary: { supported: 1 } },
    });
    const original = await readFile(source, "utf8");
    expect((await run(["--review", source, "--out", source, "--json"])).code).toBe(1);
    expect(await readFile(source, "utf8")).toBe(original);
    await writeFile(labelsPath, JSON.stringify([{ ...labels[0], outcome: "approve" }]));
    expect(
      JSON.parse((await run(["--review", source, "--reviews", labelsPath, "--json"])).output),
    ).toMatchObject({ artifact: null, errorCode: "ARTIFACT_INVALID" });
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  npRequireAgentEvaluationArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
} from "@nexpress/core/agent-contract";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  runAgentEvaluationV1,
  npRequireAgentEvaluationReportV1,
} from "@nexpress/core/agents";
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
// Real file workflow, including repeated independent artifact/hash checks; no provider bootstrap.
it("evaluates and reviews grounded Moderator recipe proposals and abstentions while preserving source and prior labels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-moderator-proposal-"));
  directories.push(dir);
  const sourcePath = join(dir, "source.json"),
    reviewPath = join(dir, "review.json"),
    labelsPath = join(dir, "labels.json");
  const evaluated = await run(["--dataset", "moderator-proposal.v1", "--out", sourcePath]);
  expect(evaluated.code).toBe(0);
  const source = await npRequireAgentEvaluationArtifactV1(
    JSON.parse(await readFile(sourcePath, "utf8")),
  );
  expect(source.suite.cases.every((c) => c.category === "moderator-proposal")).toBe(true);
  expect(
    source.caseResults.some(
      (r) => r.prediction?.moderatorResponse?.decision.kind === "propose-capability",
    ),
  ).toBe(true);
  const comparison = await run(["--dataset", "moderator-proposal.v1", "--compare", sourcePath]);
  expect(comparison.result.comparison.comparable).toBe(true);
  const template = await run(["--review", sourcePath, "--out", reviewPath]);
  expect(template.code).toBe(0);
  const review = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
    template.result.artifact,
  );
  expect(
    review.entries.some((entry) => entry.eligible && entry.response?.decision.kind === "complete"),
  ).toBe(true);
  const e = review.entries.find((e) => e.response?.decision.kind === "propose-capability")!;
  const label = {
    caseId: e.caseId,
    caseHash: e.caseHash,
    predictionHash: e.predictionHash,
    sourceHash: e.sourceHash,
    outcome: "accept",
    reviewer: "offline-local",
    reviewedAt: "2026-10-08T00:00:00.000Z",
    notes: "Synthetic quarantine proposal reviewed.",
    editedProposal: null,
  };
  await writeFile(labelsPath, JSON.stringify([label]));
  const accepted = await run([
    "--review",
    sourcePath,
    "--reviews",
    labelsPath,
    "--out",
    reviewPath,
  ]);
  expect(accepted.result.artifact.summary).toMatchObject({ reviewed: 1, accepted: 1 });
  expect(accepted.result.artifact.source).toEqual(source);
  const compared = await run([
    "--review",
    sourcePath,
    "--reviews",
    labelsPath,
    "--compare",
    reviewPath,
  ]);
  expect(compared.result.comparison).toMatchObject({ comparable: true, acceptBasisPointsDelta: 0 });
  const sourceBytes = await readFile(sourcePath, "utf8"),
    reviewBytes = await readFile(reviewPath, "utf8");
  expect((await run(["--review", sourcePath, "--out", sourcePath])).code).toBe(1);
  expect(
    (await run(["--review", sourcePath, "--reviews", labelsPath, "--out", labelsPath])).code,
  ).toBe(1);
  label.predictionHash = "invalid";
  await writeFile(labelsPath, JSON.stringify([label]));
  expect(
    (await run(["--review", sourcePath, "--reviews", labelsPath, "--out", reviewPath])).result
      .errorCode,
  ).toBe("ARTIFACT_INVALID");
  expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
  expect(await readFile(reviewPath, "utf8")).toBe(reviewBytes);
}, 20_000);

// One representative V2 workflow through the existing file owners, not a subprocess per fixture.
it("evaluates unverified report/mixed evidence, reviews it and reports a V1 baseline as incompatible", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-moderator-report-proposal-"));
  directories.push(dir);
  const sourcePath = join(dir, "source.json");
  const reviewPath = join(dir, "review.json");
  const baselinePath = join(dir, "baseline.json");
  const labelsPath = join(dir, "labels.json");
  const manifestPath = join(dir, "manifest.json");
  const evaluated = await run(["--dataset", "moderator-proposal.v2", "--out", sourcePath]);
  expect(evaluated.code).toBe(0);
  const source = await npRequireAgentEvaluationArtifactV1(
    JSON.parse(await readFile(sourcePath, "utf8")),
  );
  expect(source.suite).toMatchObject({ id: "moderator-proposal-review", version: 2 });
  expect(source.ok).toBe(true);
  expect(source.suite.cases.map((c) => c.locale)).toEqual(expect.arrayContaining(["en", "ko"]));
  const reportCase = source.suite.cases.find((c) => {
    const facts = JSON.parse(c.evidence[0].text);
    return facts.snapshot?.candidates.some(
      (candidate: { detector: { reportClaims?: unknown } }) => candidate.detector.reportClaims,
    );
  });
  expect(reportCase).toBeDefined();
  const compared = await run(["--dataset", "moderator-proposal.v2", "--compare", sourcePath]);
  expect(compared.result.comparison).toMatchObject({ comparable: true, violationDelta: 0 });
  const template = await run(["--review", sourcePath]);
  const review = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
    template.result.artifact,
  );
  const entry = review.entries.find((e) => e.caseId === reportCase!.id)!;
  expect(entry.eligible).toBe(true);
  await writeFile(
    labelsPath,
    JSON.stringify([
      {
        caseId: entry.caseId,
        caseHash: entry.caseHash,
        predictionHash: entry.predictionHash,
        sourceHash: entry.sourceHash,
        outcome: "accept",
        reviewer: "offline-local",
        reviewedAt: "2026-10-13T00:00:00.000Z",
        notes: "Synthetic report context reviewed; no spam verdict or live approval.",
        editedProposal: null,
      },
    ]),
  );
  const accepted = await run([
    "--review",
    sourcePath,
    "--reviews",
    labelsPath,
    "--out",
    reviewPath,
  ]);
  expect(accepted.code).toBe(0);
  expect(accepted.result.artifact.summary).toMatchObject({ reviewed: 1, accepted: 1 });
  const legacy = await runAgentEvaluationV1({
    suite: await npCreateAgentModeratorProposalEvaluationSuiteV1(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget: source.budget,
  });
  await Promise.all([
    writeFile(baselinePath, JSON.stringify(legacy)),
    writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "np.agent-eval-report-manifest.v1",
        entries: [
          {
            recipe: "moderator-proposal",
            evaluation: "source.json",
            review: "review.json",
            baseline: { evaluation: "baseline.json", review: null },
          },
        ],
      }),
    ),
  ]);
  const reported = await run(["--report", manifestPath]);
  expect(reported.code).toBe(0);
  const report = await npRequireAgentEvaluationReportV1(reported.result.artifact);
  expect(report.rows.find((row) => row.recipe === "moderator-proposal")).toMatchObject({
    status: "present",
    fixtureGate: "passed",
    review: { status: "present" },
    evaluationComparison: {
      status: "compared",
      result: { comparable: false, reason: "SUITE_MISMATCH" },
    },
  });
  expect(report.fullR6).toBe("not-established");
  expect(report.modelUsefulness).toBe("not-established");
}, 20_000);

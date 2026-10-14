import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  npRequireAgentEvaluationArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentModeratorProposalEvaluationEvidence,
  type NpAgentModeratorProposalEvaluationReviewLabelV1,
} from "@nexpress/core/agent-contract";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  npCreateAgentModeratorProposalEvaluationSuiteV2,
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

// Replay V3 once, then use three actual factory cases for file review/report bindings.
it("evaluates content proposals and reviews exact document/comment edits and abstention with an incompatible V2 baseline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-moderator-content-proposal-"));
  directories.push(dir);
  const sourcePath = join(dir, "source.json");
  const labelsPath = join(dir, "labels.json");
  const reviewPath = join(dir, "review.json");
  const manifestPath = join(dir, "manifest.json");
  const baselinePath = join(dir, "baseline.json");
  const evaluated = await run(["--dataset", "moderator-proposal.v3"]);
  expect(evaluated.code).toBe(0);
  const completeSource = await npRequireAgentEvaluationArtifactV1(evaluated.result.artifact);
  expect(completeSource.suite).toMatchObject({ id: "moderator-proposal-review", version: 3 });
  expect(completeSource.ok).toBe(true);
  expect(completeSource.metrics.cases).toBe(24);
  expect(completeSource.suite.cases.every((c) => c.caseVersion === 3)).toBe(true);
  const source = await runAgentEvaluationV1({
    suite: {
      ...completeSource.suite,
      cases: [
        "mp-en-document-current",
        "mp-ko-content-mixed-hostile",
        "mp-en-content-unavailable",
      ].map((id) => completeSource.suite.cases.find((c) => c.id === id)!),
    },
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget: completeSource.budget,
  });
  await writeFile(sourcePath, JSON.stringify(source));
  const template = await run(["--review", sourcePath]);
  expect(template.code).toBe(0);
  const review = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
    template.result.artifact,
  );
  const document = review.entries.find((e) => e.caseId === "mp-en-document-current")!;
  const mixed = review.entries.find((e) => e.caseId === "mp-ko-content-mixed-hostile")!;
  const abstention = review.entries.find((e) => e.caseId === "mp-en-content-unavailable")!;
  expect(document.response?.decision).toMatchObject({
    kind: "propose-capability",
    arguments: { proposal: { target: { kind: "document" } } },
  });
  expect(mixed.response?.decision).toMatchObject({
    kind: "propose-capability",
    arguments: { proposal: { target: { kind: "comment" } } },
  });
  expect(abstention.response?.decision.kind).toBe("complete");
  const mixedCase = source.suite.cases.find((c) => c.id === mixed.caseId)!;
  const evidence = npRequireAgentModeratorProposalEvaluationEvidence(mixedCase.evidence);
  const documentCandidate = evidence.snapshot!.candidates.find(
    (c) => c.proposal.target.kind === "document",
  )!;
  if (mixed.response?.decision.kind !== "propose-capability")
    throw new Error("Expected an actual admitted content proposal");
  const edited = {
    ...mixed.response,
    decision: {
      ...mixed.response.decision,
      arguments: { ...mixed.response.decision.arguments, proposal: documentCandidate.proposal },
    },
  };
  const label = (
    entry: typeof document,
    outcome: NpAgentModeratorProposalEvaluationReviewLabelV1["outcome"],
    editedProposal: NpAgentModeratorProposalEvaluationReviewLabelV1["editedProposal"] = null,
  ): NpAgentModeratorProposalEvaluationReviewLabelV1 => {
    return {
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      predictionHash: entry.predictionHash,
      sourceHash: entry.sourceHash,
      outcome,
      reviewer: "offline-local",
      reviewedAt: "2026-10-14T00:00:00.000Z",
      notes: "Exact synthetic content target or abstention reviewed; no live approval.",
      editedProposal,
    };
  };
  const labels = [
    label(document, "accept"),
    label(mixed, "edit", edited),
    label(abstention, "accept"),
  ];
  await writeFile(labelsPath, JSON.stringify(labels));
  const accepted = await run([
    "--review",
    sourcePath,
    "--reviews",
    labelsPath,
    "--out",
    reviewPath,
  ]);
  expect(accepted.code).toBe(0);
  expect(accepted.result.artifact.summary).toMatchObject({ reviewed: 3, accepted: 2, edited: 1 });
  expect(accepted.result.artifact.source).toEqual(source);
  const compared = await run([
    "--review",
    sourcePath,
    "--reviews",
    labelsPath,
    "--compare",
    reviewPath,
  ]);
  expect(compared.code).toBe(0);
  expect(compared.result.comparison).toMatchObject({ comparable: true, acceptBasisPointsDelta: 0 });
  const legacySuite = await npCreateAgentModeratorProposalEvaluationSuiteV2();
  const legacy = await runAgentEvaluationV1({
    suite: { ...legacySuite, cases: [legacySuite.cases[0]] },
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

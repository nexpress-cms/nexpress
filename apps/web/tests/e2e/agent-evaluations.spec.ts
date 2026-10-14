import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentEvaluationWorkbenchResultV1,
  npRequireAgentEvaluationSuiteV1,
  npRequireAgentModeratorProposalEvaluationEvidenceV2,
  type NpAgentEvaluationArtifactV1,
  type NpAgentModeratorProposalEvaluationReviewArtifactV1,
} from "@nexpress/core/agent-contract";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV3,
  npRequireAgentEvaluationReportV1,
  runAgentEvaluationV1,
  runAgentModeratorEvaluationV2,
  runAgentModeratorEvaluationV3,
} from "@nexpress/core/agents";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";

let evaluation: NpAgentEvaluationArtifactV1;
let importedReview: NpAgentModeratorProposalEvaluationReviewArtifactV1;
test.beforeAll(async () => {
  const suite = await npCreateAgentModeratorProposalEvaluationSuiteV3();
  // Full dataset conformance belongs to the fixture owner. This composition
  // journey retains document selection, mixed targets and retained abstention.
  const ids = [
    "mp-en-document-current",
    "mp-en-content-mixed-current",
    "mp-en-content-mixed-stale",
  ];
  const cases = suite.cases.filter((entry) => ids.includes(entry.id));
  if (cases.length !== ids.length) throw new Error("Missing document/content workspace fixture.");
  evaluation = await runAgentEvaluationV1({
    suite: npRequireAgentEvaluationSuiteV1({ ...suite, cases }),
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
  const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(evaluation);
  const proposal = template.entries.find(
    (entry) => entry.response?.decision.kind === "propose-capability",
  );
  if (!proposal) throw new Error("Expected a proposal in the shipped synthetic dataset.");
  importedReview = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(evaluation, [
    {
      caseId: proposal.caseId,
      caseHash: proposal.caseHash,
      predictionHash: proposal.predictionHash,
      sourceHash: proposal.sourceHash,
      outcome: "accept",
      reviewer: "imported-reviewer",
      reviewedAt: "2026-10-08T00:00:00.000Z",
      notes: "Existing offline review must survive reviewing another case.",
      editedProposal: null,
    },
  ]);
});

async function importArtifact(page: Page, label: string, name: string, value: unknown) {
  await page.getByLabel(label, { exact: true }).setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function recompute(page: Page, button: string) {
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/agents/evaluations" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: button, exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(
    response
      .headers()
      ["cache-control"].split(",")
      .map((value) => value.trim()),
  ).toEqual(expect.arrayContaining(["private", "no-store"]));
  const result = npRequireAgentEvaluationWorkbenchResultV1(await response.json());
  await expect(
    page.getByRole("button", { name: "Download report JSON", exact: true }),
  ).toBeEnabled();
  return result;
}

async function downloadJson(
  page: Page,
  kind: "labels" | "review" | "report",
  recipe = "moderator-proposal",
): Promise<unknown> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download ${kind} JSON`, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`${recipe}-${kind}.json`);
  const path = await download.path();
  if (!path) throw new Error("Expected a local downloaded artifact.");
  return JSON.parse(await readFile(path, "utf8"));
}

test("evaluation workspace reviews synthetic document and mixed content proposals without granting authority", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    160 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const csrf = await page.request.post("/api/admin/agents/evaluations", {
    headers: { "x-csrf-token": "invalid" },
    data: {},
  });
  expect(csrf.status()).toBe(403);
  expect(await csrf.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });

  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.startsWith("/api/admin/agents/")) writes.push(path);
  });
  await page.goto("/admin/agents");
  await page.getByRole("link", { name: "Review evaluation artifacts" }).click();
  await expect(page.getByRole("heading", { name: "Evaluation review workspace" })).toBeVisible();
  await expect(page.getByLabel("Recipe", { exact: true })).toHaveValue("moderator-proposal");
  await importArtifact(
    page,
    "Evaluation artifact (required)",
    "proposal-evaluation.json",
    evaluation,
  );
  await page.getByRole("button", { name: "Clear evaluation", exact: true }).click();
  await expect(page.getByLabel("Evaluation artifact (required)", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Validate imports", exact: true })).toBeDisabled();
  await importArtifact(
    page,
    "Evaluation artifact (required)",
    "proposal-evaluation.json",
    evaluation,
  );
  await importArtifact(
    page,
    "Current review artifact (optional)",
    "current-review.json",
    importedReview,
  );
  await importArtifact(
    page,
    "Baseline evaluation artifact (optional)",
    "baseline-evaluation.json",
    evaluation,
  );
  await importArtifact(
    page,
    "Baseline review artifact (optional)",
    "baseline-review.json",
    importedReview,
  );
  const initial = await recompute(page, "Validate imports");
  expect(initial.cases).toHaveLength(3);
  expect(evaluation.suite.version).toBe(3);
  expect(initial.authority).toBe("offline-self-reported-no-approval");
  expect(initial.fixtureGate).toBe("passed");
  for (const [index, entry] of initial.cases.entries()) {
    const evidence = JSON.parse(entry.evidenceJson);
    expect(evidence).toEqual(evaluation.suite.cases[index].evidence);
    const facts = npRequireAgentModeratorProposalEvaluationEvidenceV2(evidence);
    expect(facts.snapshot?.candidates[0].proposal.target.kind).toBe("document");
    expect(facts.snapshot?.candidates[0].detector.reportClaims).toEqual({
      unverified: true,
      itemCount: index === 0 ? 5 : 3,
    });
    if (index > 0)
      expect(facts.snapshot?.candidates.map((candidate) => candidate.proposal.target.kind)).toEqual(
        ["document", "comment"],
      );
  }
  const proposal = importedReview.entries.find((entry) => entry.review !== null)!;
  expect(proposal.response).toMatchObject({
    decision: { arguments: { proposal: { target: { kind: "document" } } } },
  });
  const mixed = importedReview.entries.find(
    (entry) => entry.caseId === "mp-en-content-mixed-current",
  );
  if (!mixed) throw new Error("Missing mixed content review fixture.");
  const abstention = importedReview.entries.find(
    (entry) => entry.response?.decision.kind === "complete",
  );
  if (!abstention) throw new Error("Expected an abstention in the shipped synthetic dataset.");
  await page
    .getByLabel("Case", { exact: true })
    .selectOption(`${proposal.caseId}@${proposal.caseVersion}`);
  await expect(
    page.getByRole("heading", { name: "Prediction", exact: true }).locator(".."),
  ).toContainText("propose-capability");
  await expect(page.getByLabel("Reviewer (self-reported)", { exact: true })).toHaveValue(
    "imported-reviewer",
  );
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }).locator(".."),
  ).toContainText("reportClaims");
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }).locator(".."),
  ).toContainText("unverified");
  await page
    .getByLabel("Case", { exact: true })
    .selectOption(`${abstention.caseId}@${abstention.caseVersion}`);
  await expect(
    page.getByRole("heading", { name: "Prediction", exact: true }).locator(".."),
  ).toContainText('"kind": "complete"');
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }).locator(".."),
  ).toContainText("stale");
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }).locator(".."),
  ).toContainText("reportClaims");
  await page.getByLabel("Outcome", { exact: true }).selectOption("accept");
  await page.getByLabel("Reviewer (self-reported)", { exact: true }).fill("browser-reviewer");
  await page
    .getByLabel("Review notes", { exact: true })
    .fill("Confirmed safe synthetic abstention.");
  await expect(
    page.getByRole("button", { name: "Download review JSON", exact: true }),
  ).toBeDisabled();
  const accepted = await recompute(page, "Apply and recompute");
  const acceptedReview = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
    JSON.parse(accepted.reviewArtifactJson!),
  );
  expect(acceptedReview.labels).toHaveLength(2);
  expect(acceptedReview.labels.find((label) => label.caseId === proposal.caseId)).toEqual(
    importedReview.labels[0],
  );

  // A syntactically valid proposal for an absent target reaches the grounding verifier.
  await page
    .getByLabel("Case", { exact: true })
    .selectOption(`${proposal.caseId}@${proposal.caseVersion}`);
  await page.getByLabel("Outcome", { exact: true }).selectOption("edit");
  const ungrounded = structuredClone(proposal.response);
  if (ungrounded?.decision.kind !== "propose-capability")
    throw new Error("Missing document proposal fixture.");
  ungrounded.decision.arguments.proposal.target.id = "00000000-0000-4000-8000-999999999999";
  await page.getByLabel("Edited proposal JSON", { exact: true }).fill(JSON.stringify(ungrounded));
  const invalidResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/agents/evaluations" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Apply and recompute", exact: true }).click();
  const invalid = await invalidResponse;
  expect(invalid.status()).toBeGreaterThanOrEqual(400);
  expect(invalid.status()).toBeLessThan(500);
  await expect(page.getByRole("alert").filter({ hasText: "could not be validated" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download labels JSON", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  const retained = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
    await downloadJson(page, "review"),
  );
  expect(retained).toEqual(acceptedReview);

  // A document-to-comment edit must copy another exact target admitted by this campaign.
  const alternative = structuredClone(mixed.response);
  const comment = npRequireAgentModeratorProposalEvaluationEvidenceV2(
    mixed.evidence,
  ).snapshot?.candidates.find((candidate) => candidate.proposal.target.kind === "comment");
  if (alternative?.decision.kind !== "propose-capability" || !comment)
    throw new Error("Missing admitted comment alternative.");
  alternative.decision.arguments.proposal = comment.proposal;
  await page
    .getByLabel("Case", { exact: true })
    .selectOption(`${mixed.caseId}@${mixed.caseVersion}`);
  await page.getByLabel("Outcome", { exact: true }).selectOption("edit");
  await page
    .getByLabel("Reviewer (self-reported)", { exact: true })
    .fill("browser-content-reviewer");
  await page.getByLabel("Edited proposal JSON", { exact: true }).fill(JSON.stringify(alternative));
  const edited = await recompute(page, "Apply and recompute");
  const labels = await downloadJson(page, "labels");
  const review = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
    await downloadJson(page, "review"),
  );
  expect(review.labels).toEqual(labels);
  expect(review).toEqual(
    await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(evaluation, labels),
  );
  expect(review.summary).toMatchObject({ reviewed: 3, accepted: 2, edited: 1, unreviewed: 0 });
  expect(review.labels.find((label) => label.caseId === proposal.caseId)).toEqual(
    importedReview.labels[0],
  );
  expect(review.labels.find((label) => label.caseId === mixed.caseId)?.editedProposal).toEqual(
    alternative,
  );
  expect(review.labels.find((label) => label.caseId === abstention.caseId)).toEqual(
    acceptedReview.labels.find((label) => label.caseId === abstention.caseId),
  );
  const report = await npRequireAgentEvaluationReportV1(await downloadJson(page, "report"));
  const row = report.rows.find((entry) => entry.recipe === "moderator-proposal");
  expect(row?.reviewComparison.status).toBe("compared");
  expect(row?.reviewComparison.result).toMatchObject({
    matchedCaseKeys: [`${proposal.caseId}@${proposal.caseVersion}`],
    unmatchedCurrentCaseKeys: [
      `${mixed.caseId}@${mixed.caseVersion}`,
      `${abstention.caseId}@${abstention.caseVersion}`,
    ],
    unmatchedBaselineCaseKeys: [],
  });
  expect(JSON.parse(edited.reportArtifactJson)).toEqual(report);
  expect(report.fullR6).toBe("not-established");
  expect(review.source.suite).toEqual(evaluation.suite);
  await expect(page.getByText("3 / 3 eligible cases reviewed", { exact: false })).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "matchedCaseKeys=1" }).first()).toContainText(
    "unmatchedCurrentCaseKeys=2",
  );

  await page.setViewportSize({ width: 320, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const screenshot = testInfo.outputPath("evaluation-review-320.png");
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("evaluation-review-320", { path: screenshot, contentType: "image/png" });

  await page.getByRole("button", { name: "Clear evaluation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download report JSON", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Case", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Validate imports", exact: true })).toBeDisabled();
  await importArtifact(
    page,
    "Evaluation artifact (required)",
    "replacement-evaluation.json",
    evaluation,
  );
  await expect(page.getByRole("button", { name: "Download labels JSON", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Validate imports", exact: true })).toBeEnabled();
  expect(writes.length).toBeGreaterThan(0);
  expect(new Set(writes)).toEqual(new Set(["/api/admin/agents/evaluations"]));
});

test("evaluation workspace labels actual document/comment detector replay and explains an incompatible v2 baseline", async ({
  page,
}, testInfo) => {
  const detector = await runAgentModeratorEvaluationV3();
  const baseline = await runAgentModeratorEvaluationV2();
  await isolateE2ERateLimitBucket(
    page.context(),
    164 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.startsWith("/api/admin/agents/")) writes.push(path);
  });
  await page.goto("/admin/agents/evaluations");
  await page.getByLabel("Recipe", { exact: true }).selectOption("moderator");
  await importArtifact(page, "Evaluation artifact (required)", "detector-v3.json", detector);
  await importArtifact(
    page,
    "Baseline evaluation artifact (optional)",
    "detector-v2.json",
    baseline,
  );
  const initial = await recompute(page, "Validate imports");
  expect(initial.authority).toBe("offline-self-reported-no-approval");
  expect(initial.fixtureGate).toBe("passed");
  expect(initial.cases).toHaveLength(32);
  const index = detector.cases.findIndex((entry) => entry.id === "mod3-en-combined-current");
  if (index < 0) throw new Error("Missing eligible mixed detector fixture.");
  const selected = initial.cases[index];
  expect(selected).toMatchObject({ caseVersion: 3, eligible: true });
  const selectedEvidence = JSON.parse(selected.evidenceJson);
  expect(selectedEvidence).toEqual(detector.cases[index]);
  const prediction = detector.caseResults[index].signals;
  expect(JSON.parse(selected.predictionJson)).toEqual(prediction);
  expect(prediction[0].facts.filter((fact) => fact.subject.kind === "document")).toHaveLength(3);
  expect(prediction[0].facts.filter((fact) => fact.subject.kind === "comment")).toHaveLength(2);
  await page.getByLabel("Case", { exact: true }).selectOption(`${selected.caseId}@3`);
  const evidence = page.getByRole("heading", { name: "Evidence", exact: true }).locator("..");
  await expect(evidence).toContainText("community.content.reported");
  await expect(evidence).toContainText("community.content.created");
  await expect(evidence).toContainText('"spamVerdict": "unknown"');
  await expect(evidence).toContainText('"kind": "document"');
  await expect(evidence).toContainText('"kind": "comment"');
  await expect(page.getByLabel("Outcome", { exact: true })).toContainText("false-positive");
  await page.getByLabel("Outcome", { exact: true }).selectOption("false-positive");
  await page
    .getByLabel("Reviewer (self-reported)", { exact: true })
    .fill("browser-detector-reviewer");
  await page
    .getByLabel("Review notes", { exact: true })
    .fill("Synthetic false positive; never a live verdict or approval.");
  const result = await recompute(page, "Apply and recompute");
  const labels = await downloadJson(page, "labels", "moderator");
  const review = await downloadJson(page, "review", "moderator");
  const report = await npRequireAgentEvaluationReportV1(
    await downloadJson(page, "report", "moderator"),
  );
  expect(report.input.entries[0].current.review).toEqual(review);
  expect(JSON.parse(result.reviewArtifactJson!)).toEqual(review);
  expect(JSON.parse(result.labelsJson!)).toEqual(labels);
  expect(review).toMatchObject({
    schemaVersion: "np.agent-moderator-eval-review.v3",
    authority: "offline-self-reported-no-approval",
    source: { dataset: "moderator.v3" },
    summary: { reviewed: 1, falsePositive: 1 },
    labels: [{ caseId: selected.caseId, sourceHash: selected.sourceHash, label: "false-positive" }],
  });
  expect(report.rows[0].evaluationComparison.result).toMatchObject({
    comparable: false,
    reason: "INCOMPATIBLE_SUITE",
    matchedSignalExpectationsDelta: null,
  });
  expect(report.fullR6).toBe("not-established");
  await expect(page.locator("pre").filter({ hasText: "INCOMPATIBLE_SUITE" }).first()).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const screenshot = testInfo.outputPath("detector-content-review-320.png");
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("detector-content-review-320", {
    path: screenshot,
    contentType: "image/png",
  });
  expect(new Set(writes)).toEqual(new Set(["/api/admin/agents/evaluations"]));
});

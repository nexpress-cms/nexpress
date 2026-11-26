import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npBuildAgentProfileEvaluationReviewArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentEvaluationWorkbenchResultV1,
  npRequireAgentEvaluationWorkbenchReportV2,
  npRequireAgentEvaluationSuiteV1,
  npRequireAgentModeratorProposalEvaluationEvidenceV2,
  type NpAgentEvaluationArtifactV1,
  type NpAgentModeratorProposalEvaluationReviewArtifactV1,
} from "@nexpress/core/agent-contract";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV3,
  npRequireAgentEvaluationReportV1,
  npRequireAgentEvaluationReportV2,
  runAgentEvaluationV1,
  runAgentModeratorEvaluationV2,
  runAgentModeratorEvaluationV3,
  npCreateAgentModeratorAssessmentEvaluationSuiteV1,
  npCreateAgentModeratorSegmentedEvaluationSuiteV2,
  npCreateAgentMemberReportEvaluationSuiteV1,
  npCreateAgentPublisherSelectionEvaluationSuiteV1,
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

async function importArtifact(target: Page | Locator, label: string, name: string, value: unknown) {
  await target.getByLabel(label, { exact: true }).setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(target.getByText(name, { exact: true })).toBeVisible();
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

test("evaluation workspace transfers reviewed results and downloads a report for three Moderator datasets", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    178 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const [member, semantic, segmented] = await Promise.all(
    [
      npCreateAgentMemberReportEvaluationSuiteV1,
      npCreateAgentModeratorAssessmentEvaluationSuiteV1,
      npCreateAgentModeratorSegmentedEvaluationSuiteV2,
    ].map(async (create) =>
      runAgentEvaluationV1({
        suite: await create(),
        mode: "fake",
        providerId: "fake",
        model: "deterministic-v1",
        budget: evaluation.budget,
      }),
    ),
  );
  const template = await npBuildAgentProfileEvaluationReviewArtifactV1(member);
  const { caseId, caseHash, predictionHash, sourceHash } = template.entries[0];
  const review = await npBuildAgentProfileEvaluationReviewArtifactV1(member, [
    {
      caseId,
      caseHash,
      predictionHash,
      sourceHash,
      outcome: "accept",
      reviewer: "report-browser-fixture",
      reviewedAt: "2026-11-26T00:00:00.000Z",
      notes: "",
      editedProposal: null,
    },
  ]);

  await page.goto("/admin/agents/evaluations");
  await page.getByText("Build a multi-dataset report", { exact: true }).click();
  const add = page.getByRole("button", { name: "Add dataset", exact: true });
  const generate = page.getByRole("button", { name: "Generate V2 report", exact: true });
  const download = page.getByRole("button", { name: "Download V2 report JSON", exact: true });
  const transfer = page.getByRole("button", { name: "Add to V2 report", exact: true });
  const replace = page.getByRole("button", { name: "Replace dataset", exact: true });
  const dataset = (index: number) =>
    page.getByRole("group", { name: `Dataset ${index}`, exact: true });
  await add.click();
  await expect(dataset(2)).toBeFocused();
  await expect(generate).toBeDisabled();
  for (const [index, source] of [member, segmented].entries()) {
    await importArtifact(
      dataset(index + 1),
      "Dataset evaluation artifact (required)",
      `${source.suite.id}.json`,
      source,
    );
  }
  await dataset(1)
    .getByLabel("Dataset current review artifact (optional)", { exact: true })
    .setInputFiles({
      name: "oversized-combined.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(4 * 1024 * 1024, " "),
    });
  await expect(dataset(1).getByRole("alert")).toHaveText(
    "All files together must fit within 4 MiB.",
  );
  await expect(generate).toBeDisabled();
  await importArtifact(
    dataset(1),
    "Dataset current review artifact (optional)",
    "member-reviewed.json",
    review,
  );
  await importArtifact(
    dataset(1),
    "Dataset baseline review artifact (optional)",
    "member-baseline-review.json",
    review,
  );
  await expect(generate).toBeDisabled();
  await importArtifact(
    dataset(1),
    "Dataset baseline evaluation artifact (optional)",
    "member-baseline.json",
    member,
  );
  await importArtifact(
    dataset(2),
    "Dataset baseline evaluation artifact (optional)",
    "incompatible-semantic-baseline.json",
    semantic,
  );

  await page.getByLabel("Recipe", { exact: true }).selectOption("moderator-assessment");
  await importArtifact(page, "Evaluation artifact (required)", "semantic-workbench.json", semantic);
  await recompute(page, "Validate imports");
  await transfer.click();
  await expect(dataset(3)).toBeFocused();
  await expect(dataset(3).getByText("Validated evaluation", { exact: true })).toBeVisible();

  await importArtifact(page, "Evaluation artifact (required)", "member-workbench.json", member);
  await expect(transfer).toHaveCount(0);
  await importArtifact(
    page,
    "Baseline evaluation artifact (optional)",
    "baseline-workbench.json",
    member,
  );
  await importArtifact(
    page,
    "Baseline review artifact (optional)",
    "baseline-review-workbench.json",
    review,
  );
  await recompute(page, "Validate imports");
  await page.getByLabel("Outcome", { exact: true }).selectOption("accept");
  const reviewer = page.getByLabel("Reviewer (self-reported)", { exact: true });
  await reviewer.fill("workbench-direct-review");
  await expect(transfer).toBeDisabled();
  const applied = await recompute(page, "Apply and recompute");

  await transfer.click();
  const keep = page.getByRole("button", { name: "Keep existing dataset", exact: true });
  await expect(keep).toBeFocused();
  await keep.click();
  await expect(dataset(1).getByText("member-reviewed.json", { exact: true })).toBeVisible();
  await expect(dataset(1)).toBeFocused();

  await transfer.click();
  await expect(replace).toBeVisible();
  await reviewer.fill("unapplied-review");
  await expect(replace).toHaveCount(0);
  await expect(transfer).toBeDisabled();
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await transfer.click();
  await replace.click();
  await expect(dataset(1)).toBeFocused();
  await expect(dataset(1).getByText("Validated current review", { exact: true })).toBeVisible();
  await expect(dataset(4)).toHaveCount(0);

  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/agents/evaluations" &&
      response.request().method() === "POST",
  );
  await generate.click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const { reportArtifactJson } = npRequireAgentEvaluationWorkbenchReportV2(await response.json());
  const summary = page.getByLabel("Report summary", { exact: true });
  await expect(summary).toContainText("moderator-segmented-assessment, version 2");
  await expect(summary).toContainText("not comparable (SUITE_MISMATCH)");
  const downloadPromise = page.waitForEvent("download");
  await download.click();
  const downloaded = await downloadPromise;
  expect(downloaded.suggestedFilename()).toBe("evaluation-report-v2.json");
  const path = await downloaded.path();
  if (!path) throw new Error("Expected a local V2 report.");
  expect(await readFile(path, "utf8")).toBe(reportArtifactJson);
  const report = await npRequireAgentEvaluationReportV2(JSON.parse(reportArtifactJson));
  expect(report.rows.filter((row) => row.dataset).map((row) => row.dataset?.id)).toEqual([
    "moderator-member-report",
    "moderator-segmented-assessment",
    "moderator-semantic-assessment",
  ]);
  expect(report.rows.find((row) => row.dataset?.id === member.suite.id)).toMatchObject({
    review: { summary: { reviewed: 1 } },
    evaluationComparison: { result: { comparable: true } },
    reviewComparison: { result: { comparable: true, acceptBasisPointsDelta: 0 } },
  });
  expect(report.rows.find((row) => row.dataset?.id === segmented.suite.id)).toMatchObject({
    evaluationComparison: { result: { comparable: false, reason: "SUITE_MISMATCH" } },
  });
  const memberEntry = report.input.entries[0];
  expect(memberEntry.current.review).toEqual(JSON.parse(applied.reviewArtifactJson!));
  expect(memberEntry.baseline).toEqual({ evaluation: member, review });

  await dataset(2).getByRole("button", { name: "Remove dataset 2", exact: true }).click();
  await expect(download).toHaveCount(0);
  await expect(dataset(2)).toBeFocused();
  await expect(generate).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

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
  await expect(
    page.getByText(
      "History storage is disabled until the host installs the evaluation history service.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save my decision", exact: true })).toHaveCount(0);
  const disabledHistory = await page.request.get("/api/admin/agents/evaluations/history");
  expect(disabledHistory.status()).toBe(503);

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

for (const [dataset, recipe, createSuite, editableField, bucket] of [
  [
    "moderator-assessment",
    "moderator-assessment",
    npCreateAgentModeratorAssessmentEvaluationSuiteV1,
    "moderatorAssessment",
    210,
  ],
  [
    "publisher-selection",
    "publisher-selection",
    npCreateAgentPublisherSelectionEvaluationSuiteV1,
    "publisherSelectionResponse",
    220,
  ],
  [
    "moderator-member-report.v1",
    "moderator-assessment",
    npCreateAgentMemberReportEvaluationSuiteV1,
    null,
    156,
  ],
  [
    "moderator-assessment.v2",
    "moderator-assessment",
    npCreateAgentModeratorSegmentedEvaluationSuiteV2,
    null,
    144,
  ],
] as const) {
  test(`${dataset} imports and reviews the explicit new profile without live execution`, async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(
      page.context(),
      bucket + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
    );
    await signInAsE2EAdmin(page);
    const suite = await createSuite();
    const cases =
      dataset === "moderator-assessment.v2"
        ? suite.cases.filter((entry) =>
            ["complete-disagreement", "missing-tail"].includes(entry.id),
          )
        : suite.cases.slice(0, 2);
    const source = await runAgentEvaluationV1({
      suite: npRequireAgentEvaluationSuiteV1({ ...suite, cases }),
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget: {
        maxCalls: 2,
        maxInputTokens: 100000,
        maxOutputTokens: 100000,
        maxCostMicros: 0,
        timeoutMs: 5000,
      },
    });
    await page.goto("/admin/agents/evaluations");
    await page.getByLabel("Recipe", { exact: true }).selectOption(recipe);
    await importArtifact(page, "Evaluation artifact (required)", `${dataset}.json`, source);
    const initial = await recompute(page, "Validate imports");
    expect(initial.recipe).toBe(recipe);
    expect(initial.fixtureGate).toBe("passed");
    const entry = initial.cases.find((entry) => entry.eligible);
    if (!entry) throw new Error("Missing reviewable new profile case");
    await page
      .getByLabel("Case", { exact: true })
      .selectOption(`${entry.caseId}@${entry.caseVersion}`);
    if (editableField) {
      await page.getByLabel("Outcome", { exact: true }).selectOption("edit");
      const edited = JSON.parse(
        await page.getByLabel("Edited structured result JSON", { exact: true }).inputValue(),
      ) as Record<string, unknown>;
      expect(edited).toHaveProperty(editableField);
    } else {
      expect(entry.allowedOutcomes).toEqual(["accept", "reject"]);
      if (dataset === "moderator-assessment.v2") {
        await expect(
          page.getByText("2 / 2 segments · 11 / 11 targets · Complete", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("uncertain", { exact: true })).toBeVisible();
        await page.getByLabel("Case", { exact: true }).selectOption("missing-tail@1");
        await expect(
          page.getByText("1 / 2 segments · 10 / 11 targets · Incomplete", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("Withheld · awaiting segments", { exact: true })).toBeVisible();
        await page
          .getByLabel("Case", { exact: true })
          .selectOption(`${entry.caseId}@${entry.caseVersion}`);
      } else {
        expect(JSON.parse(entry.predictionJson)).toMatchObject({
          actions: [],
          memberReport: { classification: "unverified-claim", disposition: "human-review" },
        });
      }
      await expect(
        page.getByLabel("Outcome", { exact: true }).locator('option[value="edit"]'),
      ).toHaveCount(0);
    }
    await page.getByLabel("Outcome", { exact: true }).selectOption("accept");
    await page
      .getByLabel("Reviewer (self-reported)", { exact: true })
      .fill("browser-fixture-review");
    const reviewed = await recompute(page, "Apply and recompute");
    expect(reviewed.cases.find((item) => item.caseId === entry.caseId)?.labelJson).toContain(
      "browser-fixture-review",
    );
    expect(reviewed.authority).toBe("offline-self-reported-no-approval");
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
        await page.getByRole("button", { name: "Close navigation" }).last().click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${dataset}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  });
}

import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentEvaluationWorkbenchResultV1,
  type NpAgentEvaluationArtifactV1,
  type NpAgentModeratorProposalEvaluationReviewArtifactV1,
} from "@nexpress/core/agent-contract";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  npRequireAgentEvaluationReportV1,
  runAgentEvaluationV1,
} from "@nexpress/core/agents";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";

let evaluation: NpAgentEvaluationArtifactV1;
let importedReview: NpAgentModeratorProposalEvaluationReviewArtifactV1;
test.beforeAll(async () => {
  evaluation = await runAgentEvaluationV1({
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

async function downloadJson(page: Page, kind: "labels" | "review" | "report"): Promise<unknown> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download ${kind} JSON`, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`moderator-proposal-${kind}.json`);
  const path = await download.path();
  if (!path) throw new Error("Expected a local downloaded artifact.");
  return JSON.parse(await readFile(path, "utf8"));
}

test("evaluation workspace reviews actual proposal and abstention artifacts without granting authority", async ({
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
  expect(initial.cases).toHaveLength(16);
  expect(initial.authority).toBe("offline-self-reported-no-approval");
  expect(initial.fixtureGate).toBe("passed");
  const proposal = importedReview.entries.find((entry) => entry.review !== null)!;
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
  await page
    .getByLabel("Case", { exact: true })
    .selectOption(`${abstention.caseId}@${abstention.caseVersion}`);
  await expect(
    page.getByRole("heading", { name: "Prediction", exact: true }).locator(".."),
  ).toContainText('"kind": "complete"');
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

  // A well-formed JSON response that violates the recipe reaches the real owner verifier.
  await page
    .getByLabel("Case", { exact: true })
    .selectOption(`${proposal.caseId}@${proposal.caseVersion}`);
  await page.getByLabel("Outcome", { exact: true }).selectOption("edit");
  await page.getByLabel("Edited proposal JSON", { exact: true }).fill(
    JSON.stringify({
      task: "interactive-capability",
      decision: { kind: "execute-capability", capabilityId: "moderation.restore" },
    }),
  );
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

  await page.getByLabel("Outcome", { exact: true }).selectOption("edit");
  await page.getByLabel("Edited proposal JSON", { exact: true }).fill(
    JSON.stringify({
      task: "interactive-capability",
      decision: { kind: "complete", summary: "Reviewer abstains on the synthetic proposal." },
    }),
  );
  const edited = await recompute(page, "Apply and recompute");
  const labels = await downloadJson(page, "labels");
  const review = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
    await downloadJson(page, "review"),
  );
  expect(review.labels).toEqual(labels);
  expect(review).toEqual(
    await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(evaluation, labels),
  );
  expect(review.summary).toMatchObject({ reviewed: 2, accepted: 1, edited: 1, unreviewed: 14 });
  expect(review.labels.find((label) => label.caseId === abstention.caseId)).toEqual(
    acceptedReview.labels.find((label) => label.caseId === abstention.caseId),
  );
  const report = await npRequireAgentEvaluationReportV1(await downloadJson(page, "report"));
  const row = report.rows.find((entry) => entry.recipe === "moderator-proposal");
  expect(row?.reviewComparison.status).toBe("compared");
  expect(row?.reviewComparison.result).toMatchObject({
    matchedCaseKeys: [`${proposal.caseId}@${proposal.caseVersion}`],
    unmatchedCurrentCaseKeys: [`${abstention.caseId}@${abstention.caseVersion}`],
    unmatchedBaselineCaseKeys: [],
  });
  expect(JSON.parse(edited.reportArtifactJson)).toEqual(report);
  await expect(page.getByText("2 / 16 eligible cases reviewed", { exact: false })).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "matchedCaseKeys=1" }).first()).toContainText(
    "unmatchedCurrentCaseKeys=1",
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

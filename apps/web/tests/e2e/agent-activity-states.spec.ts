import { errorDiagnosticsHeaders } from "./fixtures/error-diagnostics.js";
import {
  npRequireAgentContractResult,
  npAnalyzeAgentActivityRunsPageV1,
  npRequireAgentActivityActionDetailV1,
} from "@nexpress/core/agent-contract";
import { expect, test } from "@playwright/test";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

function expiredReadAction(id: string, principalId: string, runId: string) {
  const digest = `cj1:sha256:${"A".repeat(43)}`;
  return {
    schemaVersion: "np.agent-activity-action.v1",
    principalId,
    invocationId: "22222222-2222-4222-8222-222222222222",
    inputHash: digest,
    outputHash: digest,
    auditEventId: null,
    evidence: "expired",
    action: {
      schemaVersion: "np.agent-action-projection.v1",
      id,
      siteId: "default",
      runId,
      sequence: 1,
      capabilityId: "site.inspect",
      capabilityContractVersion: 1,
      capabilityFingerprint: digest,
      effectProfile: { id: "domain.read", contractVersion: 1 },
      risk: "read",
      state: "succeeded",
      inputRedacted: {},
      outputRedacted: {},
      requiredScopes: ["site:read"],
      targetRefs: [],
      proposalHash: digest,
      approvalId: null,
      verificationState: null,
      errorCode: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      startedAt: "2026-09-01T00:00:01.000Z",
      finishedAt: "2026-09-01T00:00:02.000Z",
    },
  };
}

function makeRun(id: string, goal: string, origin: "gateway" | "runtime" = "gateway") {
  return {
    schemaVersion: "np.agent-activity-run.v1",
    invocationId: null,
    evidence: "redacted",
    auditEventIds: [],
    run: {
      schemaVersion: "np.agent-run.v1",
      id,
      siteId: "default",
      origin,
      agent:
        origin === "runtime"
          ? {
              id: "44444444-4444-4444-8444-444444444444",
              versionId: "55555555-5555-4555-8555-555555555555",
            }
          : null,
      principalId: "11111111-1111-4111-8111-111111111111",
      rootRunId: id,
      parentRunId: null,
      causalDepth: 0,
      state: "succeeded",
      goal,
      runLimits: {
        schemaVersion: "np.agent-run-limits.v1",
        maxAttempts: 2,
        maxProviderCalls: 4,
        maxCapabilityCalls: 8,
        maxInputTokens: 10000,
        maxOutputTokens: 2000,
        maxCostMicros: 500000,
        maxWallClockSeconds: 300,
      },
      usage: {
        providerCalls: origin === "runtime" ? 1 : 0,
        capabilityCalls: 2,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
      },
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      queuedAt: "2026-09-01T00:00:00.000Z",
      deadlineAt: "2026-09-01T00:05:00.000Z",
      startedAt: "2026-09-01T00:00:01.000Z",
      finishedAt: "2026-09-01T00:00:02.000Z",
    },
  };
}

test("Activity preserves read-only refresh facts and isolates failed run actions", async ({
  page,
}, testInfo) => {
  const runId = "33333333-3333-4333-8333-333333333333";
  const actionId = "77777777-7777-4777-8777-777777777777";
  const goal = "한국어 운영 기록과 검토가 필요한 긴 실행 설명 ".repeat(5).trim();
  const records = Array.from({ length: 50 }, (_, index) =>
    makeRun(`33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, `${index + 1}. ${goal}`),
  );
  npRequireAgentContractResult(
    npAnalyzeAgentActivityRunsPageV1({
      schemaVersion: "np.agent-activity-runs.v1",
      items: records,
      nextCursor: null,
    }),
  );
  const run = makeRun(runId, goal);
  const action = expiredReadAction(actionId, "11111111-1111-4111-8111-111111111111", runId);
  npRequireAgentActivityActionDetailV1(action);
  let release = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let actionFailure = true;
  let runReads = 0;
  let actionReads = 0;
  await page.route("**/api/admin/agents/activity**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await gate;
    if (path.endsWith(`/actions/${actionId}`)) return route.fulfill({ json: action });
    if (path.endsWith("/actions")) {
      actionReads++;
      if (actionFailure)
        return route.fulfill({
          status: 502,
          headers: errorDiagnosticsHeaders(502, "ACTIVITY_ACTIONS_FAILED", "retry-read"),
          json: {
            status: 502,
            error: { code: "ACTIVITY_ACTIONS_FAILED", message: "The run actions read failed." },
          },
        });
      return route.fulfill({
        json: { schemaVersion: "np.agent-activity-actions.v1", items: [action], nextCursor: null },
      });
    }
    if (path.endsWith(`/${runId}`)) {
      runReads++;
      return route.fulfill({ json: run });
    }
    return route.fulfill({
      json: { schemaVersion: "np.agent-activity-runs.v1", items: records, nextCursor: null },
    });
  });
  await signInAsE2EAdmin(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/agents/activity?limit=50");
  await expect(page.getByRole("status").filter({ hasText: "Loading Activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeDisabled();
  release();
  await expect(page.getByRole("link", { name: /한국어 운영 기록/ })).toHaveCount(50);
  await expect(page.getByText("Last received", { exact: false })).toBeVisible();
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("dark", value === "dark"),
        theme,
      );
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: testInfo.outputPath(`activity-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Refreshing Activity" })).toBeVisible();
  await expect(page.getByRole("link", { name: /한국어 운영 기록/ })).toHaveCount(50);
  release();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto(`/admin/agents/activity/${runId}`);
  await expect(page.getByRole("status").filter({ hasText: "Loading Run" })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: goal.trim(), exact: true })).toBeVisible();
  await expect(page.getByText("Run actions could not be loaded.", { exact: false })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "The run actions read failed.",
  );
  const beforeRetry = runReads;
  actionFailure = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("link", { name: /site.inspect/ })).toBeVisible();
  expect(runReads).toBe(beforeRetry);
  expect(actionReads).toBe(2);
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Refreshing Run" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run identity", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto(`/admin/agents/activity/actions/${actionId}`);
  await expect(page.getByRole("status").filter({ hasText: "Loading Action" })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "Action facts", exact: true })).toBeVisible();
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Refreshing Action" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Action facts", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
});

import { test, expect } from "@playwright/test";
import { npRequireAgentActivityActionDetailV1 } from "@nexpress/core/agent-contract";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

test("Operator Activity displays exact local plan checks and bounded recovery without an execution control", async ({
  page,
}, testInfo) => {
  const id = "11111111-1111-4111-8111-111111111111",
    principalId = "22222222-2222-4222-8222-222222222222",
    planId = "33333333-3333-4333-8333-333333333333";
  const digest = `cj1:sha256:${"A".repeat(43)}`;
  const detail = npRequireAgentActivityActionDetailV1({
    schemaVersion: "np.agent-activity-action.v1",
    principalId,
    invocationId: id,
    inputHash: digest,
    outputHash: digest,
    auditEventId: null,
    evidence: "redacted",
    action: {
      schemaVersion: "np.agent-action-projection.v1",
      id,
      siteId: "default",
      runId: null,
      sequence: 1,
      capabilityId: "ops.plan",
      capabilityContractVersion: 1,
      capabilityFingerprint: digest,
      effectProfile: { id: "domain.read", contractVersion: 1 },
      risk: "read",
      state: "succeeded",
      inputRedacted: {},
      outputRedacted: {},
      requiredScopes: ["ops:plan"],
      targetRefs: [],
      proposalHash: digest,
      approvalId: null,
      verificationState: null,
      errorCode: null,
      createdAt: "2026-10-15T00:00:00.000Z",
      startedAt: "2026-10-15T00:00:00.000Z",
      finishedAt: "2026-10-15T00:00:01.000Z",
    },
    operatorReview: {
      schemaVersion: "np.agent-operator-review.v1",
      capabilityId: "ops.plan",
      checks: [
        { id: "queue.current-observation", state: "pass" },
        { id: "queue.pause", state: "warn" },
      ],
      plan: {
        schemaVersion: "np.agent-ops-plan.v1",
        planId,
        planDigest: digest,
        operation: {
          action: "queue.global.plan",
          target: { kind: "queue", operation: "drain", jobName: "agent.runExecute" },
        },
        checks: [
          { id: "queue.current-observation", status: "pass" },
          { id: "queue.pause", status: "warn" },
        ],
        expiresAt: "2026-10-15T01:00:00.000Z",
        execution: {
          kind: "local-cli-handoff",
          contractId: "runbook",
          planArtifactId: planId,
          projectCommand: "pnpm --silent run ops:runbook -- worker-not-draining --json",
        },
      },
      queue: { observedAt: "2026-10-15T00:00:00.000Z", paused: false, ready: 10, active: 1 },
      recovery: {
        monitorId: planId,
        state: "recovered",
        reason: "backlog-decreased-with-live-worker",
        startedAt: "2026-10-15T00:00:00.000Z",
        sampledAt: "2026-10-15T00:01:00.000Z",
        deadline: "2026-10-15T00:15:00.000Z",
        beforePending: 11,
        afterPending: 5,
      },
      execution: null,
    },
  });
  await page.route(`**/api/admin/agents/activity/actions/${id}`, (route) =>
    route.fulfill({ json: detail }),
  );
  await signInAsE2EAdmin(page);
  await page.goto(`/admin/agents/activity/actions/${id}`);
  await expect(page.getByText("Operator evidence and plan", { exact: true })).toBeVisible();
  await expect(page.getByText("queue.pause", { exact: true })).toBeVisible();
  await expect(
    page.getByText("pnpm --silent run ops:runbook -- worker-not-draining --json", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("recovered", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending backlog: 11 → 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /execute|restart|drain/i })).toHaveCount(0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`operator-review-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});

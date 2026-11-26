import { expect, test } from "@playwright/test";
import {
  npRequireAgentApprovalDetailV1,
  npRequireAgentGuardianSessionExecuteInputV1,
  npRequireAgentGuardianSessionPlanInputV1,
  npRequireAgentGuardianSessionV1,
  npRequireAgentIncidentStudioDetailV1,
  type NpAgentGuardianSessionExecuteInputV1,
  type NpAgentGuardianSessionPlanInputV1,
  type NpAgentGuardianSessionPlanV1,
} from "@nexpress/core/agent-contract";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

const incidentId = "53111111-1111-4111-8111-111111111111";
const signalId = "63111111-1111-4111-8111-111111111111";
const sessionFamilyId = "73111111-1111-4111-8111-111111111111";
const actionId = "83111111-1111-4111-8111-111111111111";
const approvalId = "93111111-1111-4111-8111-111111111111";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const impactDigest = `cj1:sha256:${"B".repeat(43)}`;

test("Guardian exact session revocation preserves human review, unknown-result retries and access-loss redaction", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    20 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const at = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  const target = {
    actorKind: "staff" as const,
    sessionFamilyId,
    createdAt: at,
    impact: "deployment" as const,
    affectedSiteCount: 2,
    impactDigest,
  };
  const detail = npRequireAgentIncidentStudioDetailV1({
    schemaVersion: "np.agent-incident-studio-detail.v1",
    incident: {
      version: "np.agent-incident.v1",
      id: incidentId,
      siteId: "default",
      fingerprint: "guardian-bound-session-fixture",
      category: "authentication",
      severity: "high",
      status: "open",
      title: "Successful login after repeated failures",
      summary: "A trusted successful login is linked to this exact browser session.",
      primarySubject: { kind: "session", actorKind: "staff", sessionFamilyId },
      assignedAgentId: null,
      signalIds: [signalId],
      eventCount: 6,
      firstObservedAt: at,
      lastObservedAt: at,
      containedAt: null,
      resolvedAt: null,
      resolutionCode: null,
      versionNumber: 1,
      createdAt: at,
      updatedAt: at,
    },
    signals: [
      {
        id: signalId,
        detectorId: "guardian.login-after-failures",
        detectorVersion: 1,
        confidenceBasis: "exact-rule",
        scoreBasisPoints: null,
        category: "authentication",
        createdAt: at,
      },
    ],
    timeline: [
      {
        id: signalId,
        sequence: 1,
        kind: "observed",
        createdAt: at,
        approvalId: null,
        actionId: null,
        decision: null,
      },
    ],
    nextTimelineCursor: null,
    feedback: [],
    feedbackAvailable: false,
    response: null,
    workflow: {
      availableTransitions: ["investigating", "resolved", "dismissed"],
      containment: {
        reviewHash: hash,
        total: 0,
        active: 0,
        restored: 0,
        unresolved: 0,
        pendingActions: 0,
      },
    },
  });
  for (const pattern of [
    "**/api/admin/agents/incidents/*/assignment",
    "**/api/admin/agents/incidents/*/deliveries*",
    "**/api/admin/agents/incidents/*/evidence*",
  ])
    await page.route(pattern, (route) => route.fulfill({ status: 503, json: {} }));
  await page.route(`**/api/admin/agents/incidents/${incidentId}`, (route) =>
    route.fulfill({ json: detail }),
  );

  const mutations: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname.startsWith("/api/admin/agents/"))
      mutations.push(pathname);
  });
  let planState: NpAgentGuardianSessionPlanV1["state"] | null = null;
  let accessLost = false;
  const planCommands: NpAgentGuardianSessionPlanInputV1[] = [];
  const executeCommands: NpAgentGuardianSessionExecuteInputV1[] = [];
  const endpoint = `**/api/admin/agents/incidents/${incidentId}/guardian-session`;
  await page.route(endpoint, (route) =>
    accessLost
      ? route.fulfill({ status: 403, json: {} })
      : route.fulfill({
          json: npRequireAgentGuardianSessionV1({
            schemaVersion: "np.agent-guardian-session.v1",
            incidentId,
            incidentVersion: 1,
            targetVersionDigest: hash,
            target,
            canPlan: planState === null,
            plans:
              planState === null
                ? []
                : [
                    {
                      actionId,
                      approvalId,
                      proposalHash: hash,
                      state: planState,
                      approvalExpiresAt: expiresAt,
                      canExecute: planState === "approved",
                    },
                  ],
            truncated: false,
          }),
        }),
  );
  await page.route(`${endpoint}/plan`, (route) => {
    planCommands.push(npRequireAgentGuardianSessionPlanInputV1(route.request().postDataJSON()));
    planState = "approval_pending";
    // The server committed the first request, but its response was lost.
    if (planCommands.length === 1) return route.abort("failed");
    return route.fulfill({ json: { resourceId: actionId, replayed: true } });
  });
  await page.route(`${endpoint}/execute`, (route) => {
    executeCommands.push(
      npRequireAgentGuardianSessionExecuteInputV1(route.request().postDataJSON()),
    );
    planState = "succeeded";
    if (executeCommands.length === 1) return route.abort("failed");
    return route.fulfill({ json: { resourceId: actionId, replayed: true } });
  });
  await page.route(`**/api/admin/agents/approvals/${approvalId}`, (route) =>
    route.fulfill({
      json: npRequireAgentApprovalDetailV1({
        schemaVersion: "np.agent-approval-detail.v1",
        review: null,
        rollbackReview: null,
        item: {
          schemaVersion: "np.agent-approval-list-item.v1",
          version: 1,
          approval: {
            id: approvalId,
            generation: 1,
            state: "pending",
            statementHash: hash,
            requiredHumanCapabilities: ["admin.manage"],
            requiredHumanPredicates: ["is-super-admin"],
            requestedAt: at,
            expiresAt,
            decidedAt: null,
          },
          target: { kind: "action", actionId, runId: null, agentId: null, proposalHash: hash },
          intendedOperation: null,
          scheduledFor: null,
          statementHash: hash,
          reauthentication: { mode: "recent", maxAgeSeconds: 300, assurance: "staff-primary" },
          allowedDecisions: [],
          risk: "sensitive",
          capabilityId: "security.revokeSessions",
          capabilityContractVersion: 1,
          capabilityFingerprint: hash,
          policyHashes: [hash],
          requiresLivePreview: false,
          reviewSummary: {
            operationCount: 1,
            targetCount: 1,
            previewState: null,
            checksRun: null,
            rollbackPlan: "unavailable",
          },
          requiredScopes: ["security:execute"],
          requester: { kind: "staff", id: incidentId },
        },
        actionReview: {
          actionId,
          proposalHash: hash,
          capabilityId: "security.revokeSessions",
          incidentId,
          expectedTargetVersionDigest: hash,
          target,
          policyDigest: hash,
        },
      }),
    }),
  );

  await page.goto(`/admin/agents/incidents/${incidentId}`);
  const panel = page.getByRole("region", { name: "Guardian session revocation", exact: true });
  await expect(panel.getByText("Deployment · 2 sites", { exact: true })).toBeVisible();
  await expect(panel.getByText(sessionFamilyId, { exact: true })).toBeVisible();
  await expect(panel.getByText(/do not prove an attack/)).toBeVisible();
  await expect(panel.getByText("Super administrator", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Response plans", exact: true })).toHaveCount(0);
  expect(mutations).toEqual([]);

  await panel.getByRole("button", { name: "Prepare session revocation plan", exact: true }).click();
  const retry = panel.getByRole("button", {
    name: "Retry unchanged session revocation request",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await expect(panel.getByText(/request outcome is unknown/)).toBeVisible();
  expect(planCommands).toHaveLength(1);
  await retry.click();
  await expect(
    panel.getByRole("link", { name: "Review human approval", exact: true }),
  ).toBeVisible();
  expect(planCommands).toHaveLength(2);
  expect(planCommands[1]).toEqual(planCommands[0]);
  expect(planCommands[0]).toMatchObject({
    expectedVersion: 1,
    expectedTargetVersionDigest: hash,
  });
  expect(Object.keys(planCommands[0]).sort()).toEqual([
    "expectedTargetVersionDigest",
    "expectedVersion",
    "idempotencyKey",
    "schemaVersion",
  ]);
  await expect(
    panel.getByRole("button", { name: "Execute approved session revocation" }),
  ).toHaveCount(0);
  await panel.getByRole("link", { name: "Review human approval", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/agents/approvals/${approvalId}$`));
  const approval = page.getByRole("region", {
    name: "Guardian session revocation action",
    exact: true,
  });
  await expect(
    approval.getByRole("heading", { name: "Revoke this exact browser session" }),
  ).toBeVisible();
  await expect(approval.getByText("Deployment · 2 sites", { exact: true })).toBeVisible();
  await expect(approval.getByText(sessionFamilyId, { exact: true })).toBeVisible();
  await expect(approval.getByText(impactDigest, { exact: true })).toBeVisible();
  await expect(approval.getByText(/cannot be undone/)).toBeVisible();
  await expect(approval.getByText(/different super administrator/)).toBeVisible();
  await expect(approval.locator("button")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 900 });
  if (await page.locator('[data-np-admin-sidebar][data-open="true"]').count())
    await page.getByRole("button", { name: "Close navigation" }).last().click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  // This UI fixture supplies externally approved facts; SQL integration owns signed, distinct-human approval proof.
  planState = "approved";
  await page.goBack();
  await expect(
    panel.getByRole("button", { name: "Execute approved session revocation", exact: true }),
  ).toBeVisible();
  expect(executeCommands).toEqual([]);
  await panel
    .getByRole("button", { name: "Execute approved session revocation", exact: true })
    .click();
  await expect(retry).toBeVisible();
  await expect(panel.getByText(/request outcome is unknown/)).toBeVisible();
  await expect(panel.getByText(/Session revoked\./)).toHaveCount(0);
  expect(executeCommands).toHaveLength(1);
  await retry.click();
  await expect(
    panel.getByText(/Session revoked\. Its access and refresh tokens are invalid/),
  ).toBeVisible();
  expect(executeCommands).toHaveLength(2);
  expect(executeCommands[1]).toEqual(executeCommands[0]);
  expect(executeCommands[0]).toMatchObject({
    expectedVersion: 1,
    actionId,
    approvalId,
    proposalHash: hash,
  });
  await expect(panel.getByRole("button", { name: /undo|restore|remove|revoke all/i })).toHaveCount(
    0,
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const screenshot = testInfo.outputPath("guardian-session-revocation-390.png");
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("Approved exact session revocation", {
    path: screenshot,
    contentType: "image/png",
  });
  expect(mutations).toHaveLength(4);

  accessLost = true;
  await panel.getByRole("button", { name: "Refresh session facts", exact: true }).click();
  await expect(
    page.getByText("This incident is unavailable or you no longer have access.", { exact: true }),
  ).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText(sessionFamilyId, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry unchanged session revocation request" }),
  ).toHaveCount(0);
  expect(mutations).toHaveLength(4);
});

import { expect, test } from "@playwright/test";
import {
  npRequireAgentIncidentStudioDetailV1,
  npRequireAgentIncidentEvidenceV1,
  npRequireAgentIncidentAssignmentV1,
  npRequireAgentIncidentNotificationsV1,
  type NpAgentIncidentEvidenceItemV1,
} from "@nexpress/core/agent-contract";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/admin/agents/incidents/notifications*", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.route("**/api/admin/agents/incidents/*/assignment", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.route("**/api/admin/agents/incidents/*/evidence*", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
});

const id = "51111111-1111-4111-8111-111111111111";
const signalId = "61111111-1111-4111-8111-111111111111";
const at = "2026-09-27T00:00:00.000Z";
function detail() {
  return npRequireAgentIncidentStudioDetailV1({
    schemaVersion: "np.agent-incident-studio-detail.v1",
    incident: {
      version: "np.agent-incident.v1",
      id,
      siteId: "default",
      fingerprint: "safe-fixture",
      category: "spam",
      severity: "high",
      status: "open",
      title: "Repeated links",
      summary: "Two correlated signals require human review.",
      primarySubject: null,
      assignedAgentId: null,
      signalIds: [signalId],
      eventCount: 2,
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
        detectorId: "comment.repeated-link",
        detectorVersion: 1,
        confidenceBasis: "exact-rule",
        scoreBasisPoints: 9900,
        category: "spam",
        createdAt: at,
      },
    ],
    timeline: [
      {
        id,
        sequence: 1,
        kind: "observed",
        createdAt: at,
        approvalId: null,
        actionId: null,
        decision: null,
      },
      {
        id: signalId,
        sequence: 2,
        kind: "action",
        createdAt: at,
        approvalId: id,
        actionId: id,
        decision: null,
      },
    ],
    nextTimelineCursor: null,
    feedback: [],
    feedbackAvailable: true,
    response: null,
    workflow: {
      availableTransitions: ["investigating", "resolved", "dismissed"],
      containment: {
        reviewHash: `cj1:sha256:${"a".repeat(43)}`,
        total: 2,
        active: 1,
        restored: 0,
        unresolved: 1,
        pendingActions: 0,
      },
    },
  });
}

test("incident list defaults to unresolved and filters without treating failures as empty", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    110 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const uninstalled = await page.request.get("/api/admin/agents/incidents");
  expect(uninstalled.status()).toBe(503);
  expect(uninstalled.headers()["cache-control"]).toContain("no-store");
  let unavailable = false;
  const queries: URLSearchParams[] = [];
  await page.route("**/api/admin/agents/incidents?*", (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    return unavailable
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: { schemaVersion: "np.agent-incident-list.v1", items: [], nextCursor: null },
        });
  });
  await page.goto("/admin/agents/incidents");
  await expect(page.getByText("No incidents match this view.")).toBeVisible();
  expect(queries[0]?.get("statuses")).toBe("open,investigating,contained,monitoring");
  await page.getByRole("combobox", { name: "Incident status" }).click();
  await page.getByRole("option", { name: "resolved", exact: true }).click();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => queries.at(-1)?.get("statuses")).toBe("resolved");
  await page.getByRole("combobox", { name: "Incident status" }).click();
  await page.getByRole("option", { name: "All statuses", exact: true }).click();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect
    .poll(() => queries.at(-1)?.get("statuses"))
    .toBe("open,investigating,contained,monitoring,resolved,dismissed");
  expect(queries.at(-1)?.has("categories")).toBe(false);
  expect(queries.at(-1)?.has("severities")).toBe(false);
  unavailable = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /^Request failed \(503\)$/ }),
  ).toBeVisible();
  await expect(page.getByText("No incidents match this view.")).toHaveCount(0);
});

test("incident feedback retries one identity and exposes only review links", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    114 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = detail();
  const commands: unknown[] = [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/feedback`, (route) => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) return route.abort("failed");
    result.incident.versionNumber = 2;
    result.feedback = [
      { id, signalId, label: "confirmed-spam", supersedesId: null, createdAt: at },
    ];
    return route.fulfill({ json: { resourceId: id, replayed: true } });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  await expect(page.getByRole("heading", { name: "Repeated links" })).toBeVisible();
  await expect(page.getByText("Observed fact", { exact: true })).toBeVisible();
  await expect(page.getByText("Deterministic confidence basis: exact-rule")).toBeVisible();
  await expect(page.getByText("Deterministic score: 9900 basis points")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review approval" })).toHaveAttribute(
    "href",
    `/admin/agents/approvals/${id}`,
  );
  await expect(page.getByRole("link", { name: "Review action and verification" })).toHaveAttribute(
    "href",
    `/admin/agents/activity/actions/${id}`,
  );
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`incident-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Record feedback", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry unchanged feedback" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Feedback classification" })).toBeDisabled();
  await page.getByRole("button", { name: "Retry unchanged feedback" }).click();
  await expect(page.getByText("Feedback recorded. No containment was executed.")).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0]).toMatchObject({
    signalId,
    expectedVersion: 1,
    label: "confirmed-spam",
    supersedesId: null,
  });
});

test("incident feedback conflict discards stale evidence and access loss clears the refreshed view", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    118 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  let forbidden = false;
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    forbidden ? route.fulfill({ status: 403, json: {} }) : route.fulfill({ json: detail() }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/feedback`, (route) =>
    route.fulfill({ status: 409, json: {} }),
  );
  await page.goto(`/admin/agents/incidents/${id}`);
  await page.getByRole("button", { name: "Record feedback", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This incident changed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toBeVisible();
  forbidden = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record feedback", exact: true })).toHaveCount(0);
});

test("incident investigation and closure retain one decision identity until confirmed", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    122 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = detail();
  const commands: Record<string, unknown>[] = [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/transitions`, (route) => {
    const command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 2) return route.abort("failed");
    if (commands.length === 3)
      return route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: {} });
    result.incident.versionNumber++;
    result.incident.eventCount++;
    result.incident.status = command.transition;
    result.incident.resolutionCode = command.resolutionCode;
    if (command.transition === "resolved") result.incident.resolvedAt = at;
    result.workflow!.availableTransitions =
      command.transition === "investigating" ? ["resolved", "dismissed"] : [];
    result.timeline.push({
      id: command.idempotencyKey,
      sequence: result.timeline.length + 1,
      kind: "state_transition",
      createdAt: at,
      approvalId: null,
      actionId: null,
      decision: {
        fromStatus: command.transition === "investigating" ? "open" : "investigating",
        toStatus: command.transition,
        resolutionCode: command.resolutionCode,
        note: command.note,
        containmentDisposition: command.containmentDisposition,
      },
    });
    return route.fulfill({ json: { resourceId: id, replayed: commands.length === 4 } });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  await page.getByLabel("Decision note").fill("Investigating the repeated links.");
  await page.getByRole("button", { name: "Record incident decision", exact: true }).click();
  await expect(page.getByText("Human decision: open → investigating")).toBeVisible();
  expect(commands[0]).toMatchObject({
    transition: "investigating",
    expectedVersion: 1,
    resolutionCode: null,
    containmentDisposition: null,
    containmentReviewHash: null,
  });
  await page.getByLabel("Decision note").fill("Reviewed <script>text</script>; retain quarantine.");
  await expect(
    page.getByRole("button", { name: "Record incident decision", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /explicitly retain/ }).check();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`incident-closure-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Record incident decision", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry unchanged decision" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record feedback", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Decision note")).toBeDisabled();
  await page.getByRole("button", { name: "Retry unchanged decision" }).click();
  await expect(page.getByRole("button", { name: "Retry unchanged decision" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry unchanged decision" }).click();
  await expect(page.getByText("Human decision: investigating → resolved")).toBeVisible();
  await expect(
    page.getByText("Reviewed <script>text</script>; retain quarantine.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No incident transitions are currently available.")).toBeVisible();
  expect(commands).toHaveLength(4);
  expect(commands[2]).toEqual(commands[1]);
  expect(commands[3]).toEqual(commands[1]);
  expect(commands[1]).toMatchObject({
    transition: "resolved",
    expectedVersion: 2,
    resolutionCode: "REMEDIATED",
    containmentDisposition: "retain",
    containmentReviewHash: `cj1:sha256:${"a".repeat(43)}`,
  });
});

test("incident closure conflict discards containment review and requires a fresh acknowledgement", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    126 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = detail();
  const commands: Record<string, unknown>[] = [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/transitions`, (route) => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) {
      result.workflow!.containment = {
        reviewHash: `cj1:sha256:${"b".repeat(43)}`,
        total: 2,
        active: 0,
        restored: 1,
        unresolved: 1,
        pendingActions: 0,
      };
      return route.fulfill({ status: 409, json: {} });
    }
    return route.fulfill({ status: 403, json: {} });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  await page.getByRole("combobox", { name: "Incident decision" }).click();
  await page.getByRole("option", { name: "Dismiss incident", exact: true }).click();
  await page.getByLabel("Decision note").fill("Duplicate incident, retaining active containment.");
  await page.getByRole("checkbox", { name: /explicitly retain/ }).check();
  await page.getByRole("button", { name: "Record incident decision", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "containment changed" })).toBeVisible();
  await expect(page.getByLabel("Decision note")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("combobox", { name: "Incident decision" }).click();
  await page.getByRole("option", { name: "Dismiss incident", exact: true }).click();
  await page
    .getByLabel("Decision note")
    .fill("Reviewed restored action and remaining expired containment.");
  await expect(
    page.getByRole("checkbox", { name: /acknowledge the containment/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Record incident decision", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /acknowledge the containment/ }).check();
  await page.getByRole("button", { name: "Record incident decision", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toMatchObject({
    transition: "dismissed",
    resolutionCode: "FALSE_POSITIVE",
    containmentDisposition: "acknowledge",
    containmentReviewHash: `cj1:sha256:${"b".repeat(43)}`,
  });
  expect(commands[1]!.idempotencyKey).not.toEqual(commands[0]!.idempotencyKey);
});

const responseTarget = { kind: "comment" as const, collection: "comments", id: signalId };
const targetDigest = `cj1:sha256:${"b".repeat(43)}`;
const actionId = "71111111-1111-4111-8111-111111111111";
const restoreActionId = "81111111-1111-4111-8111-111111111111";
const containmentId = "91111111-1111-4111-8111-111111111111";
function responseDetail() {
  const value = detail();
  value.response = {
    choices: [
      {
        capabilityId: "moderation.quarantine",
        target: responseTarget,
        expectedVersionDigest: targetDigest,
        containmentId: null,
      },
    ],
    plans: [],
    truncated: false,
  };
  return value;
}
function responsePlan(restore = false) {
  return {
    capabilityId: restore ? ("moderation.restore" as const) : ("moderation.quarantine" as const),
    target: responseTarget,
    expectedVersionDigest: targetDigest,
    containmentId: restore ? containmentId : null,
    actionId: restore ? restoreActionId : actionId,
    proposalHash: `cj1:sha256:${"c".repeat(43)}`,
    state: "approval_pending" as const,
    approvalId: restore ? restoreActionId : actionId,
    approvalResource: `/admin/agents/approvals/${restore ? restoreActionId : actionId}`,
    expiresAt: "2030-01-01T00:00:00.000Z",
    policyHashes: [`cj1:sha256:${"d".repeat(43)}`],
    reversibility: restore ? ("none" as const) : ("compensatable" as const),
    canExecute: false,
  };
}

test("incident response prepares an exact target, waits for approval, and explicitly quarantines and restores", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    90 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = responseDetail();
  const prepared: unknown[] = [];
  const executed: unknown[] = [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({
      json: npRequireAgentIncidentStudioDetailV1(JSON.parse(JSON.stringify(result))),
    }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/response-plan`, (route) => {
    prepared.push(route.request().postDataJSON());
    if (prepared.length === 1) return route.abort("failed");
    const restoring = prepared.length > 2;
    result.response!.plans.push(responsePlan(restoring));
    result.incident.versionNumber += 1;
    return route.fulfill({
      json: { resourceId: id, replayed: prepared.length === 2 },
    });
  });
  await page.route(`**/api/admin/agents/incidents/${id}/response-plan/execute`, (route) => {
    executed.push(route.request().postDataJSON());
    if (executed.length === 1) return route.abort("failed");
    const plan = result.response!.plans[0]!;
    plan.state = "succeeded";
    plan.canExecute = false;
    result.response!.choices = [
      {
        capabilityId: "moderation.restore",
        target: responseTarget,
        expectedVersionDigest: targetDigest,
        containmentId,
      },
    ];
    result.workflow!.containment = {
      ...result.workflow!.containment,
      total: 1,
      active: 1,
      restored: 0,
      unresolved: 0,
    };
    result.incident.versionNumber += 1;
    return route.fulfill({ json: { resourceId: id, replayed: true } });
  });
  await page.route(`**/api/admin/agents/incidents/${id}/restore`, (route) => {
    executed.push(route.request().postDataJSON());
    const plan = result.response!.plans[1]!;
    plan.state = "succeeded";
    plan.canExecute = false;
    result.response!.choices = [];
    result.workflow!.containment = {
      ...result.workflow!.containment,
      total: 1,
      active: 0,
      restored: 1,
      unresolved: 0,
    };
    result.incident.versionNumber += 1;
    return route.fulfill({ json: { resourceId: id, replayed: false } });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  const response = page.getByRole("region", { name: "Response plans" });
  await expect(
    response.getByText(`Current target version: ${targetDigest}`, { exact: true }),
  ).toBeVisible();
  await response.getByRole("button", { name: "Prepare response plan" }).click();
  await expect(response.getByRole("button", { name: "Retry unchanged response" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record feedback", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await response.getByRole("button", { name: "Retry unchanged response" }).click();
  await expect(response.getByRole("link", { name: "Review response approval" })).toHaveAttribute(
    "href",
    `/admin/agents/approvals/${actionId}`,
  );
  expect(prepared[1]).toEqual(prepared[0]);
  expect(prepared[0]).toMatchObject({
    expectedVersion: 1,
    capabilityId: "moderation.quarantine",
    proposal: {
      incidentId: id,
      target: responseTarget,
      expectedVersionDigest: targetDigest,
      reasonCode: "HUMAN_REVIEW",
    },
  });
  await expect(
    response.getByRole("button", { name: "Execute approved quarantine" }),
  ).toBeDisabled();
  expect(executed).toHaveLength(0);
  result.response!.plans[0]!.state = "approved";
  result.response!.plans[0]!.canExecute = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(response.getByRole("button", { name: "Execute approved quarantine" })).toBeEnabled();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`incident-response-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await response.getByRole("button", { name: "Execute approved quarantine" }).click();
  await response.getByRole("button", { name: "Retry unchanged response" }).click();
  await expect(
    response.getByRole("heading", { name: "Quarantine plan · succeeded" }),
  ).toBeVisible();
  expect(executed[1]).toEqual(executed[0]);
  expect(executed[0]).toMatchObject({
    expectedVersion: 2,
    actionId,
    approvalId: actionId,
    proposalHash: responsePlan().proposalHash,
  });
  await response.getByRole("button", { name: "Prepare response plan" }).click();
  await expect(response.getByRole("button", { name: "Execute approved restore" })).toBeDisabled();
  expect(prepared[2]).toMatchObject({
    capabilityId: "moderation.restore",
    proposal: {
      containmentKind: "content_quarantine",
      containmentId,
      expectedVersionDigest: targetDigest,
    },
  });
  result.response!.plans[1]!.state = "approved";
  result.response!.plans[1]!.canExecute = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await response.getByRole("button", { name: "Execute approved restore" }).click();
  await expect(response.getByRole("heading", { name: "Restore plan · succeeded" })).toBeVisible();
  await expect(page.getByText(/Containment: 1 total · 0 active · 1 restored/)).toBeVisible();
  expect(executed[2]).toMatchObject({
    expectedVersion: 4,
    actionId: restoreActionId,
    approvalId: restoreActionId,
  });
});

test("incident response shows a persisted failed quarantine after an unchanged unknown-outcome retry", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    44 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = responseDetail();
  result.response!.plans = [{ ...responsePlan(), state: "approved", canExecute: true }];
  const originalContainment = { ...result.workflow!.containment };
  const commands: unknown[] = [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({
      json: npRequireAgentIncidentStudioDetailV1(JSON.parse(JSON.stringify(result))),
    }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/response-plan/execute`, (route) => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) {
      result.response!.plans[0]!.state = "failed";
      result.response!.plans[0]!.canExecute = false;
      result.incident.versionNumber += 1;
      result.timeline.push({
        id: actionId,
        sequence: 3,
        kind: "action",
        createdAt: at,
        approvalId: actionId,
        actionId,
        decision: null,
        containmentFailure: {
          outcome: "rolled_back",
          reasonCode: "CONTAINMENT_VERIFICATION_FAILED",
        },
      });
      return route.abort("failed");
    }
    return route.fulfill({ json: { resourceId: id, replayed: true } });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  const response = page.getByRole("region", { name: "Response plans" });
  await response.getByRole("button", { name: "Execute approved quarantine" }).click();
  await expect(response.getByText(/The response outcome is unconfirmed/)).toBeVisible();
  await expect(
    response.getByText("Quarantine action has a stored failed outcome.", { exact: false }),
  ).toHaveCount(0);
  await response.getByRole("button", { name: "Retry unchanged response" }).click();
  await expect(response.getByRole("heading", { name: "Quarantine plan · failed" })).toBeVisible();
  await expect(response.getByRole("alert")).toContainText(
    "Quarantine action has a stored failed outcome.",
  );
  await expect(
    response.getByRole("button", { name: "Execute approved quarantine" }),
  ).toBeDisabled();
  await expect(response.getByRole("button", { name: "Retry unchanged response" })).toHaveCount(0);
  await expect(page.getByText(/Containment: 2 total · 1 active · 0 restored/)).toBeVisible();
  await expect(
    page.getByText(
      "Quarantine verification failed. The attempted content changes were rolled back.",
    ),
  ).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`incident-containment-failure-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  expect(result.workflow!.containment).toEqual(originalContainment);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});

test("incident response conflict and access loss remove stale plans before retry", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    96 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = responseDetail();
  result.response!.plans = [{ ...responsePlan(), state: "approved", canExecute: true }];
  let status = 409;
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({
      json: npRequireAgentIncidentStudioDetailV1(JSON.parse(JSON.stringify(result))),
    }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/response-plan/execute`, (route) =>
    route.fulfill({ status, json: {} }),
  );
  await page.goto(`/admin/agents/incidents/${id}`);
  await page.getByRole("button", { name: "Execute approved quarantine" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This response plan or its target changed" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Review response approval" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry unchanged response" })).toHaveCount(0);
  status = 403;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Execute approved quarantine" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable or you no longer have access" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
});

function evidenceItem(eventId: string): NpAgentIncidentEvidenceItemV1 {
  return {
    eventId,
    signalIds: [signalId],
    availability: "available",
    target: { ...responseTarget },
    observed: {
      occurredAt: at,
      retentionExpiresAt: "2026-09-28T00:00:00.000Z",
      status: "visible",
      spamVerdict: "flag",
      profanityVerdict: "pass",
    },
    current: { state: "unchanged", status: "visible", editedAt: null, versionDigest: targetDigest },
    responseEligible: true,
  };
}
function evidencePage(
  items: NpAgentIncidentEvidenceItemV1[],
  nextCursor: string | null = null,
  incidentVersion = 1,
) {
  return npRequireAgentIncidentEvidenceV1({
    schemaVersion: "np.agent-incident-evidence.v1",
    incidentId: id,
    incidentVersion,
    items,
    nextCursor,
  });
}

test("incident evidence separates observed and current facts, pages safely, and selects only an exact response target", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    70 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = responseDetail();
  result.response!.choices.unshift({
    ...result.response!.choices[0]!,
    target: { ...responseTarget, id: actionId },
  });
  const eligible = evidenceItem(id);
  const changed = evidenceItem(actionId);
  changed.current = { ...changed.current!, state: "changed", status: "pending", editedAt: at };
  changed.responseEligible = false;
  const deleted = evidenceItem(restoreActionId);
  deleted.current = { ...deleted.current!, state: "deleted", status: "deleted" };
  deleted.responseEligible = false;
  const hidden = evidenceItem(containmentId);
  hidden.current = { ...hidden.current!, state: "hidden", status: "hidden" };
  hidden.responseEligible = false;
  const mismatch = evidenceItem(signalId);
  mismatch.target = { ...responseTarget, id: "a1111111-1111-4111-8111-111111111111" };
  mismatch.current = { ...mismatch.current!, versionDigest: `cj1:sha256:${"e".repeat(43)}` };
  const unavailable: NpAgentIncidentEvidenceItemV1 = {
    eventId: id,
    signalIds: [signalId],
    availability: "unavailable",
    target: null,
    observed: null,
    current: null,
    responseEligible: false,
  };
  const nextCursor = `page2.${"a".repeat(43)}`;
  const cursors: Array<string | null> = [];
  const prepared: unknown[] = [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/evidence*`, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    return route.fulfill({
      json: cursor
        ? evidencePage([unavailable, mismatch])
        : evidencePage([eligible, changed, deleted, hidden], nextCursor),
    });
  });
  await page.route(`**/api/admin/agents/incidents/${id}/response-plan`, (route) => {
    prepared.push(route.request().postDataJSON());
    return route.fulfill({ json: { resourceId: id, replayed: false } });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  const evidence = page.getByRole("region", { name: "Comment evidence" });
  const response = page.getByRole("region", { name: "Response plans" });
  await expect(evidence.getByRole("heading", { name: "Recorded observation" })).toHaveCount(4);
  await expect(
    evidence.getByText("Compared with observation: changed", { exact: true }),
  ).toBeVisible();
  await expect(
    evidence.getByText("Compared with observation: deleted", { exact: true }),
  ).toBeVisible();
  await expect(
    evidence.getByText("Compared with observation: hidden", { exact: true }),
  ).toBeVisible();
  await expect(evidence.getByText(/References can retain evidence/)).toHaveCount(4);
  const selects = evidence.getByRole("button", { name: "Select for response plan" });
  await expect(selects.first()).toBeEnabled();
  for (let index = 1; index < 4; index++) await expect(selects.nth(index)).toBeDisabled();
  await selects.first().click();
  await expect(response.getByRole("combobox", { name: "Response target" })).toHaveText(
    "Quarantine comment 2",
  );
  expect(prepared).toHaveLength(0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await evidence.screenshot({
      path: testInfo.outputPath(`incident-evidence-${width}.png`),
      animations: "disabled",
    });
  }
  await evidence.getByRole("button", { name: "Next evidence page" }).click();
  await expect(
    evidence.getByText(/Its current state and retention outcome cannot be determined/),
  ).toBeVisible();
  await expect(evidence.getByText(/does not match a current response target/)).toBeVisible();
  await expect(evidence.getByRole("button", { name: "Select for response plan" })).toBeDisabled();
  await expect(response.getByRole("button", { name: "Prepare response plan" })).toBeDisabled();
  expect(cursors).toEqual([null, nextCursor]);
  await evidence.getByRole("button", { name: "First evidence page" }).click();
  await evidence.getByRole("button", { name: "Select for response plan" }).first().click();
  await response.getByRole("button", { name: "Prepare response plan" }).click();
  await expect.poll(() => prepared.length).toBe(1);
  expect(prepared[0]).toMatchObject({
    expectedVersion: 1,
    capabilityId: "moderation.quarantine",
    proposal: { target: responseTarget, expectedVersionDigest: targetDigest },
  });
});

test("incident evidence failure clears its selection, stale generations require review, and access loss clears detail", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    76 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = responseDetail();
  let evidenceStatus = 200;
  let evidenceVersion = 1;
  let staleTarget = false;
  let invalidCursor = false;
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/evidence*`, (route) => {
    if (invalidCursor && new URL(route.request().url()).searchParams.has("cursor"))
      return route.fulfill({
        status: 400,
        json: {
          status: 400,
          error: {
            code: "INCIDENT_EVIDENCE_CURSOR_INVALID",
            message: "Incident evidence cursor is invalid.",
          },
        },
      });
    return route.fulfill({
      status: evidenceStatus,
      json:
        evidenceStatus === 200
          ? evidencePage(
              [
                {
                  ...evidenceItem(id),
                  current: {
                    ...evidenceItem(id).current!,
                    versionDigest: staleTarget ? `cj1:sha256:${"e".repeat(43)}` : targetDigest,
                  },
                },
              ],
              `page2.${"a".repeat(43)}`,
              evidenceVersion,
            )
          : {},
    });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  await page.getByRole("button", { name: "Select for response plan" }).click();
  evidenceStatus = 503;
  await page.getByRole("button", { name: "Refresh comment evidence" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Comment evidence is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recorded observation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare response plan" })).toBeDisabled();
  evidenceStatus = 200;
  staleTarget = true;
  await page.getByRole("button", { name: "Refresh comment evidence" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This incident or its evidence changed" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  staleTarget = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Select for response plan" }).click();
  evidenceVersion = 2;
  await page.getByRole("button", { name: "Refresh comment evidence" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This incident or its evidence changed" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  evidenceVersion = 1;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Select for response plan" }).click();
  invalidCursor = true;
  await page.getByRole("button", { name: "Next evidence page" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This incident or its evidence changed" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Select for response plan" }).click();
  evidenceStatus = 403;
  await page.getByRole("button", { name: "Refresh comment evidence" }).click();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Current comment" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare response plan" })).toHaveCount(0);
});

const assignedAgentId = "a1111111-1111-4111-8111-111111111111";
function assignmentProjection(result: ReturnType<typeof detail>) {
  return npRequireAgentIncidentAssignmentV1({
    schemaVersion: "np.agent-incident-assignment.v1",
    incidentId: id,
    incidentVersion: result.incident.versionNumber,
    assignedAgentId: result.incident.assignedAgentId,
    current: result.incident.assignedAgentId
      ? { id: assignedAgentId, name: "Comment moderator", status: "paused", eligible: true }
      : null,
    candidates: [{ id: assignedAgentId, name: "Comment moderator", status: "paused" }],
    canAssign: true,
  });
}

test("incident assignment retries one identity then records assign and unassign without starting a run", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    48 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = detail();
  const commands: { agentId: string | null; expectedVersion: number; idempotencyKey: string }[] =
    [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/assignment`, (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: assignmentProjection(result) });
    const command = route.request().postDataJSON();
    commands.push(command);
    if (commands.length === 1) return route.abort("failed");
    const fromAgentId = result.incident.assignedAgentId;
    result.incident.assignedAgentId = command.agentId;
    result.incident.versionNumber += 1;
    result.timeline.push({
      id: commands.length === 2 ? assignedAgentId : "b1111111-1111-4111-8111-111111111111",
      sequence: result.timeline.length + 1,
      kind: "human_note",
      createdAt: at,
      approvalId: null,
      actionId: null,
      decision: null,
      assignment: { fromAgentId, toAgentId: command.agentId },
    });
    return route.fulfill({ json: { resourceId: id, replayed: commands.length === 2 } });
  });
  let executionRequests = 0;
  await page.route("**/api/admin/agents/*/runs", (route) => {
    executionRequests += 1;
    return route.abort();
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  await expect(page.getByText("Current assignment: Unassigned", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign selected Agent" })).toBeDisabled();
  await page.getByRole("combobox", { name: "Assignment candidate" }).click();
  await page
    .getByRole("option", { name: `Comment moderator · paused · ${assignedAgentId}`, exact: true })
    .click();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page
      .getByRole("heading", { name: "Assigned Agent", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`incident-assignment-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Assign selected Agent" }).click();
  await expect(page.getByRole("button", { name: "Retry unchanged assignment" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assignment candidate" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Record feedback", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Record incident decision" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry unchanged assignment" }).click();
  await expect(
    page.getByText("Current assignment: Comment moderator · paused", { exact: true }),
  ).toBeVisible();
  expect(commands[1]).toEqual(commands[0]);
  await expect(page.getByText("Human decision · Agent assignment", { exact: true })).toBeVisible();
  expect(commands[0]).toMatchObject({ expectedVersion: 1, agentId: assignedAgentId });
  await expect(
    page.getByText(`Assigned Agent: Unassigned → ${assignedAgentId}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unassign Agent" }).click();
  await expect(page.getByText("Current assignment: Unassigned", { exact: true })).toBeVisible();
  await expect(
    page.getByText(`Assigned Agent: ${assignedAgentId} → Unassigned`, { exact: true }),
  ).toBeVisible();
  expect(commands).toHaveLength(3);
  expect(commands[2]).toMatchObject({ expectedVersion: 2, agentId: null });
  expect(commands[2]!.idempotencyKey).not.toBe(commands[0]!.idempotencyKey);
  expect(executionRequests).toBe(0);
});

test("incident assignment conceals unavailable configuration and clears stale or denied reads", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    54 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = detail();
  result.incident.assignedAgentId = assignedAgentId;
  let mode: "unavailable" | "missing-agent" | "stale" | "conflict" | "denied" = "unavailable";
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/assignment`, (route) => {
    if (mode === "unavailable") return route.fulfill({ status: 503, json: {} });
    if (mode === "denied") return route.fulfill({ status: 403, json: {} });
    if (route.request().method() === "POST") return route.fulfill({ status: 409, json: {} });
    const projection = assignmentProjection(result);
    projection.current = null;
    projection.candidates = [];
    if (mode === "stale") projection.incidentVersion += 1;
    return route.fulfill({ json: projection });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "Agent assignment is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toBeVisible();
  mode = "missing-agent";
  await page.getByRole("button", { name: "Refresh Agent candidates" }).click();
  await expect(
    page.getByText("Current assignment: Assigned Agent configuration is unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Unassign Agent" })).toBeEnabled();
  mode = "stale";
  await page.getByRole("button", { name: "Refresh Agent candidates" }).click();
  await expect(
    page.getByText("This incident or its Agent assignment changed.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  mode = "conflict";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unassign Agent" })).toBeEnabled();
  await page.getByRole("button", { name: "Unassign Agent" }).click();
  await expect(
    page.getByText("This incident or its Agent assignment changed.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry unchanged assignment" })).toHaveCount(0);
  mode = "denied";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("This incident is unavailable or you no longer have access.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
});

function notifications(nextCursor: string | null = null) {
  return npRequireAgentIncidentNotificationsV1({
    schemaVersion: "np.agent-incident-notifications.v1",
    items: [
      {
        notificationId: signalId,
        incidentId: id,
        incidentVersion: 1,
        transition: "opened",
        severity: "high",
        status: "open",
        summary: "Incident opened.",
        adminPath: `/admin/agents/incidents/${id}`,
        createdAt: at,
      },
    ],
    nextCursor,
  });
}

test("incident notifications preserve recorded facts across filters and link current incidents", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    32 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const queries: string[] = [];
  const feedPage = notifications("notification-page-2");
  feedPage.items.push({
    ...feedPage.items[0]!,
    notificationId: actionId,
    incidentVersion: 2,
    transition: "containment_failed",
    status: "investigating",
    summary: "Incident containment failed.",
  });
  feedPage.items.push({
    ...feedPage.items[0]!,
    notificationId: restoreActionId,
    incidentVersion: 3,
    transition: "escalated",
    severity: "critical",
    status: "investigating",
    summary: "Incident severity escalated.",
  });
  await page.route("**/api/admin/agents/incidents?*", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "np.agent-incident-list.v1",
        items: [],
        nextCursor: null,
      },
    }),
  );
  await page.route("**/api/admin/agents/incidents/notifications*", (route) => {
    const query = new URL(route.request().url()).search;
    queries.push(query);
    return route.fulfill({
      json: query
        ? { ...notifications(), items: [] }
        : npRequireAgentIncidentNotificationsV1(feedPage),
    });
  });
  const current = detail();
  current.incident.status = "investigating";
  current.incident.versionNumber = 2;
  current.workflow!.availableTransitions = ["resolved", "dismissed"];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: current }),
  );
  await page.goto("/admin/agents/incidents");
  const feed = page.getByRole("region", { name: "Incident notifications" });
  await expect(feed.getByText("Recorded status: open · Recorded severity: high")).toBeVisible();
  await expect(feed.getByText("Incident containment failed.", { exact: true })).toBeVisible();
  await expect(feed.getByText("Incident severity escalated.", { exact: true })).toBeVisible();
  await expect(
    feed.getByText("Recorded status: investigating · Recorded severity: high"),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Incident status" }).click();
  await page.getByRole("option", { name: "resolved", exact: true }).click();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/statuses=resolved/);
  await expect(feed.getByText("Incident opened.", { exact: true })).toBeVisible();
  expect(queries.every((query) => query === "")).toBe(true);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`incident-notifications-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await feed.getByRole("button", { name: "Next notification page" }).click();
  await expect(feed.getByText("No visible incident notifications.")).toBeVisible();
  expect(queries.at(-1)).toBe("?cursor=notification-page-2");
  await feed.getByRole("button", { name: "First notification page" }).click();
  const link = feed.getByRole("link", { name: `Open incident ${id}` }).last();
  await expect(link).toHaveAttribute("href", `/admin/agents/incidents/${id}`);
  await link.click();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toBeVisible();
  await expect(page.getByText("Incident opened.", { exact: true })).toHaveCount(0);
});

test("incident notifications recover stale pages and clear access loss without inventing empty results", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    38 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  let listDenied = false;
  await page.route("**/api/admin/agents/incidents?*", (route) =>
    listDenied
      ? route.fulfill({ status: 403, json: {} })
      : route.fulfill({
          json: {
            schemaVersion: "np.agent-incident-list.v1",
            items: [detail().incident],
            nextCursor: null,
          },
        }),
  );
  let mode: "available" | "unavailable" | "denied" = "available";
  await page.route("**/api/admin/agents/incidents/notifications*", (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor"))
      return route.fulfill({
        status: 400,
        json: {
          status: 400,
          error: {
            code: "INCIDENT_NOTIFICATIONS_CURSOR_INVALID",
            message: "Invalid notification cursor.",
          },
        },
      });
    if (mode !== "available")
      return route.fulfill({ status: mode === "unavailable" ? 503 : 403, json: {} });
    return route.fulfill({ json: notifications("stale-page") });
  });
  await page.goto("/admin/agents/incidents");
  const feed = page.getByRole("region", { name: "Incident notifications" });
  await expect(feed.getByText("Incident opened.", { exact: true })).toBeVisible();
  await feed.getByRole("button", { name: "Next notification page" }).click();
  await expect(feed.getByRole("alert")).toContainText("Return to the first notification page");
  await expect(feed.getByRole("link")).toHaveCount(0);
  await feed.getByRole("button", { name: "First notification page" }).click();
  await expect(feed.getByText("Incident opened.", { exact: true })).toBeVisible();
  mode = "unavailable";
  await feed.getByRole("button", { name: "Refresh notifications" }).click();
  await expect(feed.getByRole("alert")).toContainText("Incident notifications are unavailable");
  await expect(feed.getByText("No visible incident notifications.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Repeated links", exact: true })).toBeVisible();
  mode = "available";
  await feed.getByRole("button", { name: "Refresh notifications" }).click();
  await expect(feed.getByText("Incident opened.", { exact: true })).toBeVisible();
  mode = "denied";
  await feed.getByRole("button", { name: "Refresh notifications" }).click();
  await expect(feed).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Repeated links", exact: true })).toHaveCount(0);
  mode = "available";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(feed.getByText("Incident opened.", { exact: true })).toBeVisible();
  listDenied = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(feed).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Repeated links", exact: true })).toHaveCount(0);
});

test("incident severity raises from current server choices, retries one identity and records a human decision", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    50 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = detail();
  result.workflow!.availableSeverities = ["critical"];
  const commands: Array<{
    idempotencyKey: string;
    expectedVersion: number;
    severity: string;
    note: string;
  }> = [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({
      json: npRequireAgentIncidentStudioDetailV1(JSON.parse(JSON.stringify(result))),
    }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/severity`, (route) => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) return route.abort("failed");
    result.incident.severity = "critical";
    result.incident.versionNumber += 1;
    result.workflow!.availableSeverities = [];
    result.timeline.push({
      id: actionId,
      sequence: 3,
      kind: "human_note",
      createdAt: at,
      approvalId: null,
      actionId: null,
      decision: null,
      severityChange: { fromSeverity: "high", toSeverity: "critical", note: commands[0]!.note },
    });
    return route.fulfill({ json: { resourceId: id, replayed: true } });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  const severity = page.getByRole("region", { name: "Incident severity" });
  await expect(severity.getByRole("button", { name: "Raise incident severity" })).toBeDisabled();
  await severity.getByLabel("Severity change note").fill("  Human review <script>text</script>  ");
  const refresh = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/admin/agents/incidents/${id}`) &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refresh;
  await expect(page.getByRole("heading", { name: "Comment evidence", exact: true })).toHaveCount(1);
  await expect(severity.getByLabel("Severity change note")).toHaveValue(
    "  Human review <script>text</script>  ",
  );
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`incident-severity-form-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await severity.getByRole("button", { name: "Raise incident severity" }).click();
  await expect(severity.getByText(/outcome is unconfirmed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Record feedback", exact: true })).toBeDisabled();
  await severity.getByRole("button", { name: "Retry unchanged severity change" }).click();
  await expect(page.getByText("Human severity change: high → critical")).toBeVisible();
  await expect(page.getByText("Human review <script>text</script>", { exact: true })).toBeVisible();
  await expect(severity.getByText("No severity increases are currently available.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comment evidence", exact: true })).toHaveCount(1);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`incident-severity-timeline-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0]).toMatchObject({
    expectedVersion: 1,
    severity: "critical",
    note: "Human review <script>text</script>",
  });
});

test("incident severity conflicts discard stale decisions and access loss clears the view", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    56 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = detail();
  result.workflow!.availableSeverities = ["critical"];
  let status = 409;
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/severity`, (route) =>
    route.fulfill({ status, json: {} }),
  );
  await page.goto(`/admin/agents/incidents/${id}`);
  await page.getByLabel("Severity change note").fill("Reviewed current evidence.");
  await page.getByRole("button", { name: "Raise incident severity" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "current severity and evidence" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry unchanged severity change" })).toHaveCount(
    0,
  );
  status = 403;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("Severity change note")).toHaveValue("");
  await page.getByLabel("Severity change note").fill("Reviewed again.");
  await page.getByRole("button", { name: "Raise incident severity" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable or you no longer have access" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
});

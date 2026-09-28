import { expect, test } from "@playwright/test";
import { npRequireAgentIncidentStudioDetailV1 } from "@nexpress/core/agent-contract";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

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
  await expect(page.getByRole("alert").filter({ hasText: "Request failed (503)" })).toBeVisible();
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

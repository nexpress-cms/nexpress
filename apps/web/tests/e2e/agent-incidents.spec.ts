import { expect, test } from "@playwright/test";
import {
  npRequireAgentIncidentStudioDetailV1,
  npRequireAgentIncidentEvidenceV1,
  npRequireAgentIncidentMemberReportEvidenceV1,
  npRequireAgentIncidentAssignmentV1,
  npRequireAgentIncidentNotificationsV1,
  npRequireAgentIncidentNotificationDeliveriesV1,
  type NpAgentIncidentEvidenceItemV1,
  type NpAgentIncidentMemberReportEvidenceItemV1,
} from "@nexpress/core/agent-contract";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/admin/agents/incidents/notifications*", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.route("**/api/admin/agents/incidents/*/deliveries*", (route) =>
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
  await page
    .getByRole("textbox", { name: "Detector source", exact: true })
    .fill("moderator.repeated-domain");
  await page
    .getByRole("textbox", { name: "Search incident title and summary", exact: true })
    .fill("literal %_ evidence");
  await page.getByRole("textbox", { name: "Observed since (UTC ISO)", exact: true }).fill(at);
  await page.getByRole("combobox", { name: "Active containment", exact: true }).click();
  await page.getByRole("option", { name: "No active containment", exact: true }).click();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => queries.at(-1)?.get("query")).toBe("literal %_ evidence");
  expect(queries.at(-1)?.get("source")).toBe("moderator.repeated-domain");
  expect(queries.at(-1)?.get("observedAfter")).toBe(at);
  expect(queries.at(-1)?.get("containment")).toBe("inactive");
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
  const digest = `cj1:sha256:${"a".repeat(43)}`;
  result.timeline.push({
    id: "71111111-1111-4111-8111-111111111111",
    sequence: 3,
    kind: "agent_assessment",
    createdAt: at,
    approvalId: null,
    actionId: null,
    decision: null,
    assessment: {
      schemaVersion: "np.agent-moderator-assessment.v1",
      incidentId: id,
      incidentVersion: 1,
      observedAt: at,
      label: "uncertain",
      confidenceBasisPoints: 100,
      reasonCodes: ["insufficient-evidence"],
      evidenceDigests: [],
      summary: "Evidence requires staff review.",
      evidence: {
        schemaVersion: "np.agent-moderator-assessment-evidence.v1",
        observedAt: at,
        incident: { id, versionNumber: 1, fingerprint: "safe-fixture" },
        truncated: true,
        sources: [],
      },
      provenance: {
        runId: id,
        providerCallId: signalId,
        provider: "fixture",
        model: "test-model",
        recipeFingerprint: digest,
        instructionDigest: digest,
        policyDigests: [],
        requestDigest: digest,
        responseDigest: digest,
        sourceDigest: digest,
      },
    },
  });
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
  await expect(page.getByText("AI assessment: uncertain", { exact: true })).toBeVisible();
  await expect(page.getByText("Evidence requires staff review.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review assessment Run" })).toHaveAttribute(
    "href",
    `/admin/agents/runs/${id}`,
  );
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
        notificationRecovery: {
          state: "pending",
          attempts: 1,
          lastAttemptAt: at,
          nextAttemptAt: "2026-09-27T00:00:30.000Z",
          lastErrorCode: "NOTIFICATION_RECORDING_FAILED",
        },
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
  await expect(
    page.getByText("Recording pending. Retries require host maintenance."),
  ).toBeVisible();
  await expect(page.getByText("Recording attempts: 1 of 5")).toBeVisible();
  await expect(page.getByText("Next eligible attempt:")).toContainText("2026-09-27T00:00:30.000Z");
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
  result.timeline.at(-1)!.notificationRecovery = {
    state: "sent",
    attempts: 2,
    lastAttemptAt: "2026-09-27T00:00:30.000Z",
    nextAttemptAt: null,
    lastErrorCode: null,
  };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Local Admin notification recorded. This does not confirm external delivery."),
  ).toBeVisible();
  await expect(page.getByText("Recording attempts: 2 of 5")).toBeVisible();
  await expect(page.getByText("Recording pending. Retries require host maintenance.")).toHaveCount(
    0,
  );
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
  const evidence = page.getByRole("region", { name: "Content evidence" });
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

test("incident report evidence keeps claims separate from current resolution and clears the selected response", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    82 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const result = responseDetail();
  result.response!.choices.unshift({
    ...result.response!.choices[0]!,
    target: { ...responseTarget, id: actionId },
  });
  const filed = evidenceItem(id);
  filed.observed = {
    ...filed.observed!,
    spamVerdict: "unknown",
    profanityVerdict: "unknown",
    reportFiled: true,
  };
  filed.current = {
    ...filed.current!,
    report: { status: "unresolved", resolvedAt: null },
  };
  const resolvedAt = "2026-09-27T01:00:00.000Z";
  const resolved: NpAgentIncidentEvidenceItemV1 = {
    ...structuredClone(filed),
    eventId: actionId,
    target: { ...responseTarget },
    current: { ...filed.current, report: { status: "resolved", resolvedAt } },
    responseEligible: false,
  };
  const changed: NpAgentIncidentEvidenceItemV1 = {
    ...structuredClone(filed),
    eventId: containmentId,
    target: { ...responseTarget },
    current: {
      ...filed.current,
      state: "changed",
      editedAt: resolvedAt,
      report: { status: "unresolved", resolvedAt: null },
    },
    responseEligible: false,
  };
  let prepared = 0;
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/evidence*`, (route) =>
    route.fulfill({ json: evidencePage([filed, resolved, changed]) }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/response-plan`, (route) => {
    prepared += 1;
    return route.fulfill({ json: { resourceId: id, replayed: false } });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  const evidence = page.getByRole("region", { name: "Content evidence" });
  const response = page.getByRole("region", { name: "Response plans" });
  await expect(evidence.getByRole("heading", { name: "Recorded report" })).toHaveCount(3);
  await expect(evidence.getByText(/A report is an unverified claim/)).toHaveCount(3);
  await expect(evidence.getByText(/Spam:|Profanity:/)).toHaveCount(0);
  await expect(evidence.getByText("Report status: unresolved", { exact: true })).toHaveCount(2);
  await expect(evidence.getByText("Report status: resolved", { exact: true })).toBeVisible();
  const rows = evidence.locator("li");
  await expect(rows.nth(1).getByText("Resolved:")).toContainText(resolvedAt);
  await expect(rows.nth(2).getByText("Compared with observation: changed")).toBeVisible();
  const selects = evidence.getByRole("button", { name: "Select for response plan" });
  await expect(selects.first()).toBeEnabled();
  await expect(selects.nth(1)).toBeDisabled();
  await expect(selects.nth(2)).toBeDisabled();
  await selects.first().click();
  await expect(response.getByRole("combobox", { name: "Response target" })).toHaveText(
    "Quarantine comment 2",
  );
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await evidence.screenshot({
      path: testInfo.outputPath(`incident-report-evidence-${width}.png`),
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(evidence.getByRole("heading", { name: "Recorded report" })).toHaveCount(3);
  await expect(response.getByRole("combobox", { name: "Response target" })).not.toHaveText(
    /Quarantine comment/,
  );
  await expect(response.getByRole("button", { name: "Prepare response plan" })).toBeDisabled();
  await selects.first().click();
  await expect(response.getByRole("combobox", { name: "Response target" })).toHaveText(
    "Quarantine comment 2",
  );
  filed.current.report = { status: "resolved", resolvedAt };
  filed.responseEligible = false;
  await evidence.getByRole("button", { name: "Refresh content evidence" }).click();
  await expect(evidence.getByText("Report status: resolved", { exact: true })).toHaveCount(2);
  await expect(selects.first()).toBeDisabled();
  await expect(response.getByRole("button", { name: "Prepare response plan" })).toBeDisabled();
  await expect(page.getByText(`Incident ${id} · Version 1`, { exact: true })).toBeVisible();
  expect(prepared).toBe(0);
});

test("document report evidence reviews actual visibility, selects the exact target, and clears resolved or inaccessible evidence", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    168 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const documentTarget = { kind: "document" as const, collection: "posts", id: signalId };
  const result = responseDetail();
  result.response!.choices.push({
    ...result.response!.choices[0]!,
    target: documentTarget,
  });
  const filed: NpAgentIncidentEvidenceItemV1 = {
    eventId: id,
    signalIds: [signalId],
    availability: "available",
    target: documentTarget,
    observed: {
      occurredAt: at,
      retentionExpiresAt: "2026-09-28T00:00:00.000Z",
      status: "published",
      visibility: "public",
      spamVerdict: "unknown",
      profanityVerdict: "unknown",
      reportFiled: true,
    },
    current: {
      state: "unchanged",
      status: "published",
      visibility: "public",
      moderationHidden: false,
      editedAt: at,
      versionDigest: targetDigest,
      report: { status: "unresolved", resolvedAt: null },
    },
    responseEligible: true,
  };
  const hidden: NpAgentIncidentEvidenceItemV1 = {
    ...structuredClone(filed),
    eventId: actionId,
    target: { ...documentTarget, id: actionId },
    current: {
      ...structuredClone(filed.current!),
      state: "hidden",
      status: "pending",
      moderationHidden: true,
    },
    responseEligible: false,
  };
  const privateDocument: NpAgentIncidentEvidenceItemV1 = {
    ...structuredClone(filed),
    eventId: containmentId,
    target: { ...documentTarget, id: containmentId },
    current: {
      ...structuredClone(filed.current!),
      state: "changed",
      status: "draft",
      visibility: "private",
      editedAt: "2026-09-27T01:00:00.000Z",
    },
    responseEligible: false,
  };
  let evidenceStatus = 200;
  const prepared: unknown[] = [];
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: result }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/evidence*`, (route) =>
    route.fulfill({
      status: evidenceStatus,
      json: evidenceStatus === 200 ? evidencePage([filed, hidden, privateDocument]) : {},
    }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/response-plan`, (route) => {
    prepared.push(route.request().postDataJSON());
    return route.fulfill({ json: { resourceId: id, replayed: false } });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  const evidence = page.getByRole("region", { name: "Content evidence" });
  const response = page.getByRole("region", { name: "Response plans" });
  const rows = evidence.locator("li");
  await expect(evidence.getByRole("heading", { name: "Current document" })).toHaveCount(3);
  await expect(evidence.getByRole("heading", { name: "Recorded report" })).toHaveCount(3);
  await expect(evidence.getByText(/A report is an unverified claim/)).toHaveCount(3);
  await expect(evidence.getByText(/Spam:|Profanity:/)).toHaveCount(0);
  await expect(
    rows.first().getByText(`Document: posts · ${signalId}`, { exact: true }),
  ).toBeVisible();
  await expect(rows.first().getByText("Visibility: public", { exact: true })).toHaveCount(2);
  await expect(rows.first().getByText("Moderation hidden: No", { exact: true })).toBeVisible();
  await expect(rows.nth(1).getByText("Moderation hidden: Yes", { exact: true })).toBeVisible();
  await expect(rows.nth(2).getByText("Status: draft", { exact: true })).toBeVisible();
  await expect(rows.nth(2).getByText("Visibility: private", { exact: true })).toBeVisible();
  const selects = evidence.getByRole("button", { name: "Select for response plan" });
  await expect(selects.first()).toBeEnabled();
  await expect(selects.nth(1)).toBeDisabled();
  await expect(selects.nth(2)).toBeDisabled();
  await selects.first().click();
  await expect(response.getByRole("combobox", { name: "Response target" })).toHaveText(
    "Quarantine document 2",
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
      path: testInfo.outputPath(`incident-document-report-evidence-${width}.png`),
      animations: "disabled",
    });
  }
  await response.getByRole("button", { name: "Prepare response plan" }).click();
  await expect.poll(() => prepared.length).toBe(1);
  expect(prepared[0]).toMatchObject({
    expectedVersion: 1,
    capabilityId: "moderation.quarantine",
    proposal: { target: documentTarget, expectedVersionDigest: targetDigest },
  });
  await expect(response.getByRole("button", { name: "Prepare response plan" })).toBeDisabled();
  await selects.first().click();
  filed.current!.report = { status: "resolved", resolvedAt: "2026-09-27T01:00:00.000Z" };
  filed.responseEligible = false;
  await evidence.getByRole("button", { name: "Refresh content evidence" }).click();
  await expect(rows.first().getByText("Report status: resolved", { exact: true })).toBeVisible();
  await expect(selects.first()).toBeDisabled();
  await expect(response.getByRole("button", { name: "Prepare response plan" })).toBeDisabled();
  filed.current!.report = { status: "unresolved", resolvedAt: null };
  filed.responseEligible = true;
  await evidence.getByRole("button", { name: "Refresh content evidence" }).click();
  await selects.first().click();
  evidenceStatus = 403;
  await evidence.getByRole("button", { name: "Refresh content evidence" }).click();
  await expect(page.getByRole("heading", { name: "Current document" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare response plan" })).toHaveCount(0);
  expect(prepared).toHaveLength(1);
});

test("member report evidence connects bounded site restrictions and authorized management while claims remain read-only", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    174 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const memberId = "b1111111-1111-4111-8111-111111111111";
  const result = detail();
  result.incident.primarySubject = { kind: "member", memberId };
  result.incident.category = "abuse";
  result.incident.severity = "info";
  result.incident.title = "Member report review";
  result.incident.summary = "A filed member report requires human review.";
  result.incident.eventCount = 1;
  result.signals = [
    {
      id: signalId,
      detectorId: "moderator.member-report-review",
      detectorVersion: 1,
      confidenceBasis: "external",
      scoreBasisPoints: null,
      category: "abuse",
      createdAt: at,
    },
  ];
  result.timeline = result.timeline.slice(0, 1);
  result.workflow = null;
  result.feedbackAvailable = false;
  result.response = null;
  const memberDetail = npRequireAgentIncidentStudioDetailV1(result);
  const filed: NpAgentIncidentMemberReportEvidenceItemV1 = {
    eventId: id,
    signalIds: [signalId],
    availability: "available",
    target: { kind: "member", id: memberId },
    observed: {
      occurredAt: at,
      retentionExpiresAt: "2026-09-28T00:00:00.000Z",
      status: "active",
      claim: "unverified",
    },
    current: {
      state: "unchanged",
      status: "active",
      updatedAt: at,
      versionDigest: targetDigest,
      report: { status: "unresolved", resolvedAt: null },
      reviewContext: {
        siteId: "default",
        snapshotAt: at,
        activeRestrictions: [
          { scopeType: "site", scopeId: null, kind: "permanent", expiresAt: null },
          {
            scopeType: "collection",
            scopeId: "posts",
            kind: "temporary",
            expiresAt: "2026-09-28T00:00:00.000Z",
          },
        ],
        hasMoreRestrictions: false,
        canOpenMemberManagement: true,
      },
    },
    responseEligible: false,
  };
  const unavailable: NpAgentIncidentMemberReportEvidenceItemV1 = {
    eventId: actionId,
    signalIds: [signalId],
    availability: "unavailable",
    target: null,
    observed: null,
    current: null,
    responseEligible: false,
  };
  const cursor = "sealed-member-report-page";
  let cursorInvalid = false;
  let evidenceVersion = 1;
  let evidenceStatus = 200;
  const posts: string[] = [];
  const memberRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/admin/agents/"))
      posts.push(request.url());
    if (request.url().includes(`/admin/members/${memberId}`)) memberRequests.push(request.url());
  });
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: memberDetail }),
  );
  await page.route(`**/api/admin/agents/incidents/${id}/member-report-evidence*`, (route) => {
    const paged = new URL(route.request().url()).searchParams.has("cursor");
    if (paged && cursorInvalid)
      return route.fulfill({
        status: 400,
        json: {
          status: 400,
          error: {
            code: "INCIDENT_MEMBER_REPORT_EVIDENCE_CURSOR_INVALID",
            message: "Member report evidence cursor is invalid.",
          },
        },
      });
    return route.fulfill({
      status: evidenceStatus,
      json:
        evidenceStatus === 200
          ? npRequireAgentIncidentMemberReportEvidenceV1({
              schemaVersion: "np.agent-incident-member-report-evidence.v1",
              incidentId: id,
              incidentVersion: evidenceVersion,
              items: paged ? [unavailable] : [filed],
              nextCursor: paged ? null : cursor,
            })
          : {},
    });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  const evidence = page.getByRole("region", { name: "Member report evidence" });
  await expect(evidence.getByRole("heading", { name: "Filed member report" })).toBeVisible();
  await expect(evidence.getByText(`Member: ${memberId}`, { exact: true })).toBeVisible();
  await expect(
    evidence.getByText("Recorded account status: active", { exact: true }),
  ).toBeVisible();
  await expect(evidence.getByText("Global account status: active", { exact: true })).toBeVisible();
  await expect(evidence.getByText("Site report status: unresolved", { exact: true })).toBeVisible();
  const restrictions = evidence.getByRole("region", { name: "Current site restrictions" });
  await expect(restrictions.getByText("Scope: site — this site", { exact: true })).toBeVisible();
  await expect(restrictions.getByText("Scope: collection — posts", { exact: true })).toBeVisible();
  await expect(restrictions.getByText("Expires: No expiry", { exact: true })).toBeVisible();
  await expect(restrictions.locator('time[datetime="2026-09-28T00:00:00.000Z"]')).toBeVisible();
  await expect(restrictions.getByRole("link", { name: "Open member management" })).toHaveAttribute(
    "href",
    `/admin/members/${memberId}`,
  );
  await expect(restrictions.getByText(/does not establish prior restrictions/)).toBeVisible();
  await expect(
    evidence.getByText("Claim: unverified. No abuse assessment was recorded.", { exact: true }),
  ).toBeVisible();
  await expect(evidence.getByText(/References can retain evidence/)).toBeVisible();
  await expect(page.getByText("Report evidence basis: external", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Abuse assessment score: Not assessed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Content evidence" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Response plans" })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Select for response plan|Prepare response plan|Execute approved/,
    }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 900 });
  if (await page.locator('[data-np-admin-sidebar][data-open="true"]').count())
    await page.getByRole("button", { name: "Close navigation" }).last().click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await evidence.screenshot({
    path: testInfo.outputPath("incident-member-report-evidence-320.png"),
    animations: "disabled",
  });
  expect(memberRequests).toEqual([]);
  filed.current!.reviewContext = {
    ...filed.current!.reviewContext!,
    activeRestrictions: Array.from({ length: 25 }, (_, index) => ({
      scopeType: "collection",
      scopeId: `bounded-scope-${index}`,
      kind: "permanent",
      expiresAt: null,
    })),
    hasMoreRestrictions: true,
    canOpenMemberManagement: false,
  };
  filed.current!.state = "changed";
  filed.current!.status = "suspended";
  filed.current!.updatedAt = "2026-09-27T01:00:00.000Z";
  filed.current!.versionDigest = `cj1:sha256:${"b".repeat(43)}`;
  filed.current!.report = { status: "resolved", resolvedAt: "2026-09-27T01:00:00.000Z" };
  await evidence.getByRole("button", { name: "Refresh member report evidence" }).click();
  await expect(
    evidence.getByText("Compared with filed account state: changed", { exact: true }),
  ).toBeVisible();
  await expect(
    evidence.getByText("Global account status: suspended", { exact: true }),
  ).toBeVisible();
  await expect(evidence.getByText("Site report status: resolved", { exact: true })).toBeVisible();
  await expect(restrictions.getByRole("link", { name: "Open member management" })).toHaveCount(0);
  await expect(restrictions.getByText(/unavailable with your current permissions/)).toBeVisible();
  await expect(restrictions.getByText(/Only the first 25 active restrictions/)).toBeVisible();
  await expect(
    evidence.getByText("Recorded account status: active", { exact: true }),
  ).toBeVisible();
  await evidence.getByRole("button", { name: "Next member report page" }).click();
  await expect(
    evidence.getByText(/Its current account state and retention outcome cannot be determined/),
  ).toBeVisible();
  await expect(evidence.getByRole("heading", { name: "Current member" })).toHaveCount(0);
  await evidence.getByRole("button", { name: "First member report page" }).click();
  cursorInvalid = true;
  await evidence.getByRole("button", { name: "Next member report page" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This incident or its evidence changed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Member report review", exact: true }),
  ).toHaveCount(0);
  cursorInvalid = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(evidence.getByRole("heading", { name: "Current member" })).toBeVisible();
  evidenceVersion = 2;
  await evidence.getByRole("button", { name: "Refresh member report evidence" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This incident or its evidence changed" }),
  ).toBeVisible();
  evidenceVersion = 1;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(evidence.getByRole("heading", { name: "Current member" })).toBeVisible();
  evidenceStatus = 403;
  await evidence.getByRole("button", { name: "Refresh member report evidence" }).click();
  await expect(
    page.getByRole("heading", { name: "Member report review", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Current member" })).toHaveCount(0);
  await expect(page.getByText(memberId, { exact: false })).toHaveCount(0);
  expect(posts).toEqual([]);
  expect(memberRequests).toEqual([]);
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
  await page.getByRole("button", { name: "Refresh content evidence" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Content evidence is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recorded observation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare response plan" })).toBeDisabled();
  evidenceStatus = 200;
  staleTarget = true;
  await page.getByRole("button", { name: "Refresh content evidence" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This incident or its evidence changed" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repeated links" })).toHaveCount(0);
  staleTarget = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Select for response plan" }).click();
  evidenceVersion = 2;
  await page.getByRole("button", { name: "Refresh content evidence" }).click();
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
  await page.getByRole("button", { name: "Refresh content evidence" }).click();
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
  await expect(page.getByRole("heading", { name: "Content evidence", exact: true })).toHaveCount(1);
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
  await expect(page.getByRole("heading", { name: "Content evidence", exact: true })).toHaveCount(1);
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

test("incident summaries and response target pages keep unknown evidence and target choice explicit", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    228 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const first = responseDetail();
  const responseCursor = `eyJvZmZzZXQiOjEwfQ.${"a".repeat(43)}`;
  first.response!.truncated = true;
  first.response!.nextCursor = responseCursor;
  first.incident.assignedAgentId = actionId;
  const second = structuredClone(first);
  second.response!.choices[0]!.target = { ...responseTarget, id: actionId };
  second.response!.nextCursor = null;
  second.response!.truncated = false;
  const detailQueries: URLSearchParams[] = [];
  const prepared: unknown[] = [];
  let unknown = false;
  await page.route("**/api/admin/agents/incidents?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("includeSummaries")).toBe("true");
    return route.fulfill({
      json: {
        schemaVersion: "np.agent-incident-list.v1",
        items: [first.incident],
        nextCursor: null,
        summaries: [
          {
            incidentId: id,
            versionNumber: first.incident.versionNumber,
            containment: unknown
              ? null
              : { active: 1, nearestExpiryAt: "2026-10-16T00:00:00.000Z" },
            assessmentAvailable: unknown ? null : true,
          },
        ],
      },
    });
  });
  await page.route(new RegExp(`/api/admin/agents/incidents/${id}(?:\\?.*)?$`), (route) => {
    const query = new URL(route.request().url()).searchParams;
    detailQueries.push(query);
    return route.fulfill({
      json: npRequireAgentIncidentStudioDetailV1(
        query.get("responseCursor") === responseCursor ? second : first,
      ),
    });
  });
  await page.route(`**/api/admin/agents/incidents/${id}/response-plan`, (route) => {
    prepared.push(route.request().postDataJSON());
    return route.fulfill({ json: { resourceId: id, replayed: false } });
  });
  await page.goto("/admin/agents/incidents");
  await expect(page.getByText(`Assigned Agent: ${actionId}`, { exact: true })).toBeVisible();
  await expect(page.getByText("Active containments: 1", { exact: true })).toBeVisible();
  await expect(
    page.getByText("AI assessment: Available for review", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Nearest containment expiry: 2026-10-16/)).toBeVisible();
  await page.getByRole("link", { name: "Repeated links", exact: true }).click();
  const response = page.getByRole("region", { name: "Response plans" });
  await response.getByRole("button", { name: "Next response targets", exact: true }).click();
  await expect(
    response.getByRole("button", { name: "First response targets", exact: true }),
  ).toBeVisible();
  await expect(response.getByRole("combobox", { name: "Response target" })).toHaveText(
    "Select a response target",
  );
  expect(detailQueries.at(-1)?.get("responseCursor")).toBe(responseCursor);
  expect(detailQueries.at(-1)?.has("cursor")).toBe(false);
  await response.getByRole("combobox", { name: "Response target" }).click();
  await page.getByRole("option", { name: "Quarantine comment 1", exact: true }).click();
  await expect(response.getByText(new RegExp(`Target: comment.*${actionId}`))).toBeVisible();
  await response.getByRole("button", { name: "Prepare response plan", exact: true }).click();
  await expect.poll(() => prepared.length).toBe(1);
  expect(prepared[0]).toMatchObject({ proposal: { target: { id: actionId } }, expectedVersion: 1 });
  unknown = true;
  await page.getByRole("link", { name: "All incidents", exact: true }).click();
  await expect(page.getByText("Active containments: Unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("AI assessment: Unknown", { exact: true })).toBeVisible();
});

test("segmented Incident assessment distinguishes full snapshot coverage from incomplete review", async ({
  page,
}, testInfo) => {
  await signInAsE2EAdmin(page);
  const result = detail();
  const digest = `cj1:sha256:${"A".repeat(43)}`;
  const callIds = Array.from(
    { length: 16 },
    (_, index) => `01900000-0000-7000-8000-${(index + 1).toString().padStart(12, "0")}`,
  );
  const assessment = {
    schemaVersion: "np.agent-moderator-segmented-assessment.v2" as const,
    incidentId: id,
    incidentVersion: result.incident.versionNumber,
    observedAt: at,
    label: "spam" as const,
    confidenceBasisPoints: 6000,
    reasonCodes: ["repeated-template" as const],
    summary: "All sixteen recorded batches support the same advisory classification.",
    coverage: {
      manifestDigest: digest,
      signalCount: 2,
      eventCount: 151,
      targetCount: 151,
      segmentCount: 16,
      incomplete: false,
      complete: true,
    },
    segmentProviderCallIds: callIds,
    proofDigest: digest,
    provenance: {
      runId: id,
      provider: "synthetic-browser-fixture",
      model: "no-inference",
      recipeFingerprint: digest,
      instructionDigest: digest,
      policyDigests: [digest],
    },
  };
  result.timeline = [
    {
      id: signalId,
      sequence: 3,
      kind: "agent_assessment",
      createdAt: at,
      approvalId: null,
      actionId: null,
      decision: null,
      segmentedAssessment: assessment,
    },
  ];
  let denied = false;
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    denied
      ? route.fulfill({ status: 403, json: {} })
      : route.fulfill({ json: npRequireAgentIncidentStudioDetailV1(result) }),
  );
  await page.goto(`/admin/agents/incidents/${id}`);
  await expect(page.getByText("AI assessment across batches: spam", { exact: true })).toBeVisible();
  await expect(page.getByText(/Coverage: 16 of 16 batches; 151 content targets/)).toBeVisible();
  await expect(
    page.getByText("All evidence in this recorded snapshot was covered.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review assessment batches in Run" }),
  ).toHaveAttribute("href", `/admin/agents/runs/${id}`);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`segmented-assessment-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  result.timeline[0].segmentedAssessment = {
    ...assessment,
    label: "uncertain",
    confidenceBasisPoints: 0,
    reasonCodes: ["insufficient-evidence"],
    summary: "Incomplete evidence cannot establish a verdict for the entire Incident.",
    coverage: { ...assessment.coverage, complete: false },
    segmentProviderCallIds: callIds.slice(0, 15),
  };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("AI assessment across batches: uncertain", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Evidence coverage is incomplete/)).toBeVisible();
  denied = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/AI assessment across batches:/)).toHaveCount(0);
});

test("Incident external delivery status stays distinct from local recording and unknown delivery outcomes", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    212 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  await page.route(`**/api/admin/agents/incidents/${id}`, (route) =>
    route.fulfill({ json: detail() }),
  );
  let mode: "records" | "absent" | "denied" = "records";
  const queries: Array<string | null> = [];
  const item = {
    notificationId: id,
    connectionId: signalId,
    channel: "slack",
    incidentVersion: 1,
    state: "failed",
    outcome: "unknown",
    attempts: 1,
    lastErrorCode: "DELIVERY_OUTCOME_UNKNOWN",
    nextAttemptAt: null,
    sentAt: null,
    createdAt: at,
    updatedAt: at,
  };
  await page.route(`**/api/admin/agents/incidents/${id}/deliveries*`, (route) => {
    expect(route.request().method()).toBe("GET");
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    queries.push(cursor);
    if (mode !== "records")
      return route.fulfill({ status: mode === "denied" ? 403 : 503, json: {} });
    const items = cursor
      ? [{ ...item, state: "sent", outcome: "confirmed", sentAt: at, lastErrorCode: null }]
      : [item];
    return route.fulfill({
      json: npRequireAgentIncidentNotificationDeliveriesV1({
        schemaVersion: "np.agent-incident-notification-deliveries.v1",
        incidentId: id,
        items,
        nextCursor: cursor ? null : "delivery-page-2",
      }),
    });
  });
  await page.goto(`/admin/agents/incidents/${id}`);
  const panel = page.getByRole("region", { name: "External notification delivery", exact: true });
  await expect(panel.getByText("Slack · Failed", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Delivery outcome unknown/)).toContainText(
    "may have been delivered",
  );
  await expect(panel.getByText("Confirmed not sent.", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/Local Admin notification recording is separate/)).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await panel.screenshot({
      path: testInfo.outputPath(`incident-external-delivery-${width}.png`),
      animations: "disabled",
    });
  }
  await panel.getByRole("button", { name: "Next delivery page" }).click();
  await expect(panel.getByText("Delivery confirmed.", { exact: true })).toBeVisible();
  expect(queries.at(-1)).toBe("delivery-page-2");
  mode = "absent";
  await panel.getByRole("button", { name: "Refresh delivery status" }).click();
  await expect(panel.getByRole("alert")).toContainText("disabled or unavailable");
  await expect(panel.getByText("Delivery confirmed.", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/No visible external delivery records/)).toHaveCount(0);
  mode = "records";
  await panel.getByRole("button", { name: "First delivery page" }).click();
  await expect(panel.getByText(/Delivery outcome unknown/)).toBeVisible();
  mode = "denied";
  await panel.getByRole("button", { name: "Refresh delivery status" }).click();
  await expect(page.getByRole("heading", { name: "Repeated links", exact: true })).toHaveCount(0);
  await expect(page.getByText("DELIVERY_OUTCOME_UNKNOWN", { exact: true })).toHaveCount(0);
  mode = "records";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(panel.getByText(/Delivery outcome unknown/)).toBeVisible();
});

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
      { id, sequence: 1, kind: "observed", createdAt: at, approvalId: null, actionId: null },
      { id: signalId, sequence: 2, kind: "action", createdAt: at, approvalId: id, actionId: id },
    ],
    nextTimelineCursor: null,
    feedback: [],
    feedbackAvailable: true,
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

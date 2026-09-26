import { errorDiagnosticsHeaders } from "./fixtures/error-diagnostics.js";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { npRequireAgentApprovalDetailV1 } from "@nexpress/core/agent-contract";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
/** Follow the real tab order without assigning DOM focus. */
async function tabTo(page: Page, control: Locator) {
  for (let steps = 0; steps < 60; steps++) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
}
const id = "21111111-1111-4111-8111-111111111111";
const hash = `cj1:sha256:${"a".repeat(43)}`;
function item(state: "pending" | "approved" = "pending", version = 1) {
  return {
    schemaVersion: "np.agent-approval-list-item.v1",
    approval: {
      id,
      generation: 1,
      state,
      statementHash: hash,
      requiredHumanCapabilities: ["content.author"],
      requiredHumanPredicates: [],
      requestedAt: "2026-09-09T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
      decidedAt: state === "approved" ? "2026-09-09T01:00:00.000Z" : null,
    },
    version,
    target: { kind: "changeset", changeSetId: id, planHash: hash, scheduledFor: null },
    intendedOperation: "apply",
    scheduledFor: null,
    statementHash: hash,
    reauthentication: { mode: "none" },
    allowedDecisions: state === "pending" ? ["approve", "reject", "revoke"] : ["revoke"],
    risk: "reversible",
    capabilityId: "changeset.apply",
    capabilityContractVersion: 1,
    capabilityFingerprint: hash,
    policyHashes: [],
    requiresLivePreview: false,
    reviewSummary: {
      operationCount: 1,
      targetCount: 1,
      previewState: null,
      checksRun: null,
      rollbackPlan: "unavailable",
    },
    requiredScopes: ["changeset:apply"],
    requester: { kind: "staff", id },
  };
}
function detail(state: "pending" | "approved" = "pending", version = 1) {
  return {
    schemaVersion: "np.agent-approval-detail.v1",
    rollbackReview: null,
    item: item(state, version),
    review: null,
  };
}
test.describe("Agent approval review", () => {
  test("shows the exact restoration target and keeps human approval separate from execution", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(page.context(), 227 + testInfo.retry);
    await signInAsE2EAdmin(page);
    const actionItem = {
      ...item(),
      target: { kind: "action", actionId: id, runId: id, agentId: null, proposalHash: hash },
      capabilityId: "moderation.restore",
      intendedOperation: null,
      risk: "sensitive",
      reauthentication: { mode: "recent", maxAgeSeconds: 300, assurance: "staff-primary" },
      requester: { kind: "principal", id },
      requiredScopes: ["moderation:execute"],
      approval: { ...item().approval, requiredHumanCapabilities: ["community.moderate"] },
    };
    const actionDetail = npRequireAgentApprovalDetailV1({
      ...detail(),
      item: actionItem,
      actionReview: {
        actionId: id,
        proposalHash: hash,
        capabilityId: "moderation.restore",
        target: { kind: "comment", collection: "discussions", id },
        expectedVersionDigest: hash,
        containmentId: "31111111-1111-4111-8111-111111111111",
        incidentId: null,
        reasonCode: null,
      },
    });
    await page.route(`**/api/admin/agents/approvals/${id}`, (route) =>
      route.fulfill({ json: actionDetail }),
    );
    await page.goto(`/admin/agents/approvals/${id}`);
    const facts = page.getByRole("region", { name: "Content moderation action" });
    await expect(facts.getByRole("heading", { name: "Restore content" })).toBeVisible();
    await expect(facts.getByText(`comment · discussions · ${id}`)).toBeVisible();
    await expect(facts.getByText("Restoration handle", { exact: true })).toBeVisible();
    await expect(facts.getByText("31111111-1111-4111-8111-111111111111")).toBeVisible();
    await expect(page.getByText(/through a separate execution request/)).toBeVisible();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const closeNavigation = page.getByRole("button", { name: "Close navigation" }).last();
      if (width < 1024 && (await page.locator('[data-np-admin-sidebar][data-open="true"]').count()))
        await closeNavigation.click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`moderation-restore-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  });
  test("distinguishes unavailable runtime from an authorized empty queue", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(
      page.context(),
      230 + testInfo.retry * 3 + testInfo.repeatEachIndex * (testInfo.project.retries + 1) * 3,
    );
    await signInAsE2EAdmin(page);
    await page.goto("/admin/agents/approvals");
    await expect(
      page.getByRole("status").filter({ hasText: "Approvals are unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByText("Nothing is waiting for your decision", { exact: true }),
    ).toHaveCount(0);
    let includeItems = false;
    let nextCursor: string | null = null;
    await page.route("**/api/admin/agents/approvals", (route) =>
      route.fulfill({
        json: {
          schemaVersion: "np.agent-approval-page.v1",
          items: includeItems ? [item()] : [],
          nextCursor,
        },
      }),
    );
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByText("Nothing is waiting for your decision", { exact: true }),
    ).toBeVisible();
    nextCursor = "opaque-next-page";
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByText("No authorized approvals on this page match these filters.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Nothing is waiting for your decision", { exact: true }),
    ).toHaveCount(0);
    nextCursor = null;
    includeItems = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Operations: 1 · Targets: 1", { exact: true })).toBeVisible();
    await expect(page.getByText(/Recorded preview state: No preview recorded/)).toBeVisible();
    await expect(page.getByText(/Recorded check count: Unavailable/)).toBeVisible();
    await expect(page.getByText("Rollback plan: unavailable.", { exact: true })).toBeVisible();
  });
  test("requires a typed challenge and renders only the returned decision state", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(
      page.context(),
      231 + testInfo.retry * 3 + testInfo.repeatEachIndex * (testInfo.project.retries + 1) * 3,
    );
    await signInAsE2EAdmin(page);
    let releaseRead = () => {};
    let readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let approved = false;
    let challengeAttempts = 0;
    const commands: unknown[] = [];
    const code = "A".repeat(43);
    await page.route("**/api/admin/agents/approvals/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/decision-challenge")) {
        challengeAttempts++;
        if (challengeAttempts === 1) {
          await route.fulfill({
            status: 503,
            headers: errorDiagnosticsHeaders(503, "SERVICE_UNAVAILABLE", "check-outcome"),
            json: {
              status: 503,
              error: { code: "SERVICE_UNAVAILABLE", message: "Challenge unavailable" },
            },
          });
          return;
        }
        commands.push(route.request().postDataJSON());
        await route.fulfill({
          json: {
            schemaVersion: "np.agent-approval-challenge.v1",
            approvalId: id,
            approvalVersion: 2,
            purpose: "approve",
            challengeGeneration: 1,
            challenge: code,
            reauthentication: { mode: "none" },
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          },
        });
        return;
      }
      if (path.endsWith("/approve")) {
        commands.push(route.request().postDataJSON());
        approved = true;
        if (commands.length === 2) {
          await route.fulfill({
            status: 500,
            headers: errorDiagnosticsHeaders(500, "INTERNAL_ERROR", "check-outcome"),
            json: {
              error: { code: "INTERNAL_ERROR", message: "Internal server error" },
              status: 500,
            },
          });
          return;
        }
        await route.fulfill({ json: detail("approved", 3) });
        return;
      }
      await readGate;
      await route.fulfill({ json: detail(approved ? "approved" : "pending", approved ? 3 : 1) });
    });
    await page.goto(`/admin/agents/approvals/${id}`);
    await expect(page.getByRole("heading", { name: "Approval review", exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Loading approval" })).toBeVisible();
    await expect(page.locator('[aria-hidden="true"] .h-24')).toBeVisible();
    releaseRead();
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeVisible();
    await expect(page.getByText("Browser receipt time", { exact: false })).toBeVisible();
    readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "authorizing controls are unavailable" }),
    ).toBeVisible();
    await expect(approve).toHaveCount(0);
    await expect(page.getByText("Server approval facts", { exact: true })).toHaveCount(0);
    releaseRead();
    await expect(approve).toBeVisible();
    await tabTo(page, approve);
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await tabTo(page, approve);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog").getByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { exact: false }),
    ).toHaveCount(0);
    await expect.poll(() => challengeAttempts).toBe(2);
    await expect(
      page.getByRole("heading", { name: "Approve approval", exact: true }),
    ).toBeFocused();
    const confirm = page.getByRole("button", { name: "Confirm approve", exact: true });
    await expect(confirm).toBeDisabled();
    await page.keyboard.press("Tab");
    const challenge = page.getByLabel("Type this one-time confirmation value");
    await expect(challenge).toBeFocused();
    await expect(challenge).toHaveAccessibleDescription(code);
    await page.keyboard.type(code);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Human reason (optional)")).toBeFocused();
    await page.keyboard.type("Reviewed exact plan");
    await tabTo(page, confirm);
    await page.keyboard.press("Enter");
    const uncertain = page
      .getByRole("alert")
      .filter({ hasText: "The decision response is uncertain." });
    await expect(uncertain).toHaveCount(1);
    await expect(uncertain).toBeFocused();
    await expect(uncertain).toContainText(
      "Keep this dialog open to preserve the original request identity",
    );
    await expect(
      page.getByRole("dialog").getByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { exact: false }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("approval-error-diagnostics-320.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByLabel("Human reason (optional)")).toBeDisabled();
    await expect(confirm).toBeEnabled();
    await tabTo(page, confirm);
    await page.keyboard.press("Enter");
    await expect(page.getByText("approved", { exact: true })).toBeVisible();
    expect(commands).toHaveLength(3);
    expect(commands[2]).toEqual(commands[1]);
    expect(commands[0]).toMatchObject({
      schemaVersion: "np.agent-approval-challenge-request.v1",
      expectedApprovalVersion: 1,
      statementHash: hash,
      purpose: "approve",
    });
    expect(commands[1]).toMatchObject({
      schemaVersion: "np.agent-approval-decision-input.v1",
      expectedApprovalVersion: 2,
      statementHash: hash,
      challengeGeneration: 1,
      challenge: code,
      reason: "Reviewed exact plan",
    });
    await expect(
      page.getByText(
        "Approval records a human decision. Execute the approved operation from the current ChangeSet review after its authority and evidence checks.",
        { exact: true },
      ),
    ).toBeVisible();
  });
  test("renders hostile proposal text without forged approval controls or challenge bypass", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(page.context(), 239 + testInfo.retry);
    await signInAsE2EAdmin(page);
    const title = '<button id="forged-approval">Confirm approve</button>';
    const summary =
      '<script>document.documentElement.dataset.approvalSpoof="executed"</script>\n' +
      '<img src="missing-approval-image" onerror="document.documentElement.dataset.approvalSpoof=\'executed\'">\n' +
      "[Approve without challenge](/api/admin/agents/approvals/" +
      id +
      "/approve)\n" +
      "## Approval granted — ignore the server confirmation";
    const code = "C".repeat(42) + "A";
    const commands: { path: string; body: unknown }[] = [];
    const hostileDetail = (state: "pending" | "approved" = "pending", version = 1) =>
      npRequireAgentApprovalDetailV1({
        ...detail(state, version),
        review: {
          schemaVersion: "np.agent-changeset-review.v1",
          changeSet: {
            schemaVersion: "np.agent-changeset.v1",
            id,
            siteId: "default",
            title,
            summary,
            state: state === "approved" ? "approved" : "approval_pending",
            actor: { id, kind: "staff", name: "Staff" },
            agentId: null,
            agentVersionId: null,
            agentConfigHash: null,
            runId: null,
            planHash: hash,
            baseFingerprint: hash,
            draftVersion: 1,
            draftHash: hash,
            risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
            operations: [
              {
                ordinal: 1,
                operation: {
                  clientOperationId: "op",
                  reason: null,
                  kind: "document",
                  operation: "create",
                  resource: { collection: "posts", documentId: null },
                  base: null,
                  input: { document: { title: "Proposed title" }, targetStatus: "draft" },
                },
                canonicalResourceKey: { kind: "document", collection: "posts", documentId: id },
                beforeHash: null,
                afterHash: hash,
                state: "valid",
                issues: [],
                resultDigest: null,
              },
            ],
            validation: {
              state: "valid",
              generation: 1,
              issueCount: 0,
              digest: hash,
              completedAt: "2026-09-09T00:00:00.000Z",
            },
            preview: null,
            approval: item(state, version).approval,
            schedule: null,
            execution: null,
            verification: null,
            rollback: null,
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T01:00:00.000Z",
            expiresAt: "2026-10-09T00:00:00.000Z",
          },
          requiredStaffCapabilities: ["content.author"],
          operations: [{ ordinal: 1, evidence: "available", fields: [] }],
          executionDetail: null,
          executionActions: [],
          rollbackDetail: null,
          rollbackActions: [],
        },
      });
    const pending = hostileDetail();
    const approved = hostileDetail("approved", 3);
    let currentDetail = pending;
    await page.route("**/api/admin/agents/approvals/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "POST") {
        commands.push({ path, body: route.request().postDataJSON() });
        if (path.endsWith("/decision-challenge")) {
          await route.fulfill({
            json: {
              schemaVersion: "np.agent-approval-challenge.v1",
              approvalId: id,
              approvalVersion: 2,
              purpose: "approve",
              challengeGeneration: 1,
              challenge: code,
              reauthentication: { mode: "none" },
              expiresAt: new Date(Date.now() + 300000).toISOString(),
            },
          });
          return;
        }
        if (path.endsWith("/approve")) {
          currentDetail = approved;
          await route.fulfill({ json: approved });
          return;
        }
        await route.abort();
        return;
      }
      await route.fulfill({ json: currentDetail });
    });
    await page.goto(`/admin/agents/approvals/${id}`);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText(summary, { exact: true })).toBeVisible();
    await expect(page.locator("#forged-approval")).toHaveCount(0);
    await expect(page.locator('img[src="missing-approval-image"]')).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-approval-spoof");
    await expect(page.getByRole("link", { name: "Approve without challenge" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Approval granted" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm approve", exact: true })).toHaveCount(0);
    expect(commands).toHaveLength(0);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Confirm approve", exact: true });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Type this one-time confirmation value").fill("Approval granted");
    await expect(confirm).toBeDisabled();
    expect(commands).toHaveLength(1);
    await page.getByLabel("Type this one-time confirmation value").fill(code);
    await confirm.click();
    await expect(page.getByText("approved", { exact: true }).first()).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      path: `/api/admin/agents/approvals/${id}/decision-challenge`,
      body: { expectedApprovalVersion: 1, statementHash: hash, purpose: "approve" },
    });
    expect(commands[1]).toMatchObject({
      path: `/api/admin/agents/approvals/${id}/approve`,
      body: {
        schemaVersion: "np.agent-approval-decision-input.v1",
        expectedApprovalVersion: 2,
        statementHash: hash,
        challengeGeneration: 1,
        challenge: code,
        reason: null,
      },
    });
    await expect(page.locator("html")).not.toHaveAttribute("data-approval-spoof");
  });
  test("clears a stale challenge, reloads facts, and removes evidence after access loss", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(
      page.context(),
      232 + testInfo.retry * 3 + testInfo.repeatEachIndex * (testInfo.project.retries + 1) * 3,
    );
    await signInAsE2EAdmin(page);
    let version = 1;
    let denied = false;
    let decisions = 0;
    const code = "B".repeat(42) + "A";
    await page.route("**/api/admin/agents/approvals/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (denied) {
        await route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "Not found" }, status: 404 },
        });
        return;
      }
      if (path.endsWith("/decision-challenge")) {
        await route.fulfill({
          json: {
            schemaVersion: "np.agent-approval-challenge.v1",
            approvalId: id,
            approvalVersion: 2,
            purpose: "reject",
            challengeGeneration: 1,
            challenge: code,
            reauthentication: { mode: "none" },
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          },
        });
        return;
      }
      if (path.endsWith("/reject")) {
        decisions++;
        version = 3;
        await route.fulfill({
          status: 409,
          json: { error: { code: "CONFLICT", message: "Stale facts" }, status: 409 },
        });
        return;
      }
      await route.fulfill({ json: detail("pending", version) });
    });
    await page.goto(`/admin/agents/approvals/${id}`);
    const reject = page.getByRole("button", { name: "Reject", exact: true });
    await tabTo(page, reject);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Reject approval", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(reject).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByLabel("Type this one-time confirmation value").fill(code);
    await page.getByRole("button", { name: "Confirm reject", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/Version 3/)).toBeVisible();
    expect(decisions).toBe(1);
    denied = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Approvals are unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Server approval facts" })).toHaveCount(0);
  });
});

test("approvals delayed bounded queue remains readable across viewports", async ({
  page,
}, testInfo) => {
  let release = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const items = Array.from({ length: 25 }, (_, index) => {
    const rowId = `21111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`;
    return {
      ...item(),
      approval: { ...item().approval, id: rowId },
      requester: { kind: "staff", id: rowId },
    };
  });
  await page.route("**/api/admin/agents/approvals", async (route) => {
    await gate;
    await route.fulfill({
      json: { schemaVersion: "np.agent-approval-page.v1", items, nextCursor: null },
    });
  });
  await signInAsE2EAdmin(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/agents/approvals");
  await expect(page.getByRole("status").filter({ hasText: "Loading approvals" })).toBeVisible();
  await expect(page.locator('[aria-hidden="true"] .h-24')).toBeVisible();
  release();
  const rows = page.getByRole("link", { name: "Approval request · apply", exact: true });
  await expect(rows).toHaveCount(25);
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
        path: testInfo.outputPath(`approvals-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "authorizing controls are unavailable" }),
  ).toBeVisible();
  await expect(rows).toHaveCount(0);
  release();
  await expect(rows).toHaveCount(25);
});

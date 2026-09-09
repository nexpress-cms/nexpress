import { expect, test } from "@playwright/test";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
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
  return { schemaVersion: "np.agent-approval-detail.v1", item: item(state, version), review: null };
}
test.describe("Agent approval review", () => {
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
    let approved = false;
    const commands: unknown[] = [];
    const code = "A".repeat(43);
    await page.route("**/api/admin/agents/approvals/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/decision-challenge")) {
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
      await route.fulfill({ json: detail(approved ? "approved" : "pending", approved ? 3 : 1) });
    });
    await page.goto(`/admin/agents/approvals/${id}`);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Confirm approve", exact: true });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Type this one-time confirmation value").fill(code);
    await page.getByLabel("Human reason (optional)").fill("Reviewed exact plan");
    await confirm.click();
    await expect(page.getByLabel("Human reason (optional)")).toBeDisabled();
    await expect(confirm).toBeEnabled();
    await confirm.click();
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
        "Approval records a human decision. Apply, schedule execution and rollback are not available here.",
        { exact: true },
      ),
    ).toBeVisible();
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
    await page.getByRole("button", { name: "Reject", exact: true }).click();
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

import { errorDiagnosticsHeaders } from "./fixtures/error-diagnostics.js";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  npRequireAgentApprovalDetailV1,
  npRequireAgentApprovalChallengeOutputV1,
  npRequireAgentChangeSetReviewV1,
} from "@nexpress/core/agent-contract";
import { agentLifecycleCheckpoint } from "./fixtures/agent-lifecycle-checkpoint.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
/** Traverse the actual keyboard order; never assign DOM focus. */
async function tabTo(page: Page, control: Locator) {
  for (let steps = 0; steps < 60; steps++) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
}
const id = "11111111-1111-4111-8111-111111111111";
const hash = `cj1:sha256:${"a".repeat(43)}`;
function draft() {
  return {
    schemaVersion: "np.agent-changeset.v1",
    id,
    siteId: "default",
    title: "Review fixture proposal",
    summary: "<script>untrusted assessment</script>",
    state: "draft",
    actor: { id, kind: "staff", name: "Staff" },
    agentId: null,
    agentVersionId: null,
    agentConfigHash: null,
    runId: null,
    planHash: null,
    baseFingerprint: null,
    draftVersion: 1,
    draftHash: hash,
    risk: null,
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
        afterHash: null,
        state: "draft",
        issues: [],
        resultDigest: null,
      },
    ],
    validation: null,
    preview: null,
    approval: null,
    schedule: null,
    execution: null,
    verification: null,
    rollback: null,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    expiresAt: "2026-10-08T00:00:00.000Z",
  };
}
test.describe("Agent ChangeSet review", () => {
  test("backs off active review polling and stops when evidence becomes unavailable", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(page.context(), 209 + testInfo.retry);
    await signInAsE2EAdmin(page);
    const clockStart = new Date();
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
    let reads = 0;
    let releaseSecond: (() => void) | undefined;
    const secondRead = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    await page.route(`**/api/admin/agents/changesets/${id}`, async (route) => {
      reads++;
      if (reads === 2) await secondRead;
      if (reads >= 3) {
        await route.fulfill({
          status: reads === 3 ? 429 : 401,
          headers: {
            ...errorDiagnosticsHeaders(
              reads === 3 ? 429 : 401,
              "RECOVERY_REQUIRED",
              reads === 3 ? "retry-read" : "reauthenticate",
            ),
            ...(reads === 3 ? { "Retry-After": "30" } : {}),
          },
          json: {
            status: reads === 3 ? 429 : 401,
            error: { code: "RECOVERY_REQUIRED", message: "Read recovery required" },
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          schemaVersion: "np.agent-changeset-review.v1",
          changeSet: {
            ...draft(),
            summary: reads === 2 ? "Second poll completed" : draft().summary,
            state: "validating",
            validation: {
              state: "running",
              generation: 1,
              issueCount: 0,
              digest: null,
              completedAt: null,
            },
          },
          requiredStaffCapabilities: ["content.author"],
          operations: [{ ordinal: 1, evidence: "not_validated", fields: [] }],
          executionDetail: null,
          executionActions: [],
          rollbackDetail: null,
          rollbackActions: [],
        },
      });
    });
    await page.goto(`/admin/agents/changesets/${id}`);
    await expect(page.getByText("Review fixture proposal", { exact: true })).toBeVisible();
    expect(reads).toBe(1);
    await page.clock.fastForward(2_000);
    await expect.poll(() => reads).toBe(2);
    await expect(page.getByText("Review fixture proposal", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading ChangeSet…", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Refreshing ChangeSet" }),
    ).toBeVisible();
    await expect(page.getByText("Browser receipt time", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
    releaseSecond?.();
    await expect(page.getByText("Second poll completed", { exact: true })).toBeVisible();
    await page.clock.fastForward(3_999);
    expect(reads).toBe(2);
    await page.clock.fastForward(1);
    await expect.poll(() => reads).toBe(3);
    await expect(page.getByText("Review fixture proposal", { exact: true })).toHaveCount(0);
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeDisabled();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`review-rate-limit-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.clock.fastForward(29_999);
    expect(reads).toBe(3);
    await expect(retry).toBeDisabled();
    await page.clock.fastForward(1);
    await expect(retry).toBeEnabled();
    expect(reads).toBe(3);
    await retry.click();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
      "href",
      "/admin/login",
    );
    await expect(page.getByText("Review fixture proposal", { exact: true })).toHaveCount(0);
    await page.clock.fastForward(30_000);
    expect(reads).toBe(4);
    await page.goto("/admin/agents");
    await page.clock.fastForward(30_000);
    expect(reads).toBe(4);
  });
  test("late refresh reads cannot restore review evidence after mutation authentication loss", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(page.context(), 215 + testInfo.retry);
    await signInAsE2EAdmin(page);
    await page.clock.install();
    let reads = 0;
    let mutations = 0;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseMutation: (() => void) | undefined;
    const mutation = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const review = {
      schemaVersion: "np.agent-changeset-review.v1",
      changeSet: draft(),
      requiredStaffCapabilities: ["content.author"],
      operations: [{ ordinal: 1, evidence: "not_validated", fields: [] }],
      executionDetail: null,
      executionActions: ["cancel"],
      rollbackDetail: null,
      rollbackActions: [],
    };
    await page.route("**/api/admin/agents/changesets**", async (route) => {
      if (route.request().method() === "POST") {
        mutations++;
        await mutation;
        await route.fulfill({
          status: 401,
          json: { status: 401, error: { code: "UNAUTHORIZED", message: "Sign in required" } },
        });
        return;
      }
      reads++;
      if (reads === 2) await pending;
      await route.fulfill({ json: review });
    });
    await page.goto(`/admin/agents/changesets/${id}`);
    await expect(page.getByText("Review fixture proposal", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel ChangeSet", exact: true }).click();
    await expect.poll(() => mutations).toBe(1);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => reads).toBe(2);
    releaseMutation?.();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    release?.();
    await page.clock.fastForward(30_000);
    await expect(page.getByText("Review fixture proposal", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    expect(reads).toBe(2);
  });
  test("distinguishes unavailable runtime from empty history", async ({ page }, testInfo) => {
    await isolateE2ERateLimitBucket(page.context(), 180 + testInfo.retry * 3);
    await signInAsE2EAdmin(page);
    await page.goto("/admin/agents/changesets");
    await expect(
      page.getByRole("status").filter({ hasText: "ChangeSet history is unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByText("No authorized ChangeSets on this page.", { exact: true }),
    ).toHaveCount(0);
  });
  test("opens authorized detail, escapes proposal text, and clears evidence on permission loss", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(page.context(), 181 + testInfo.retry * 3);
    await signInAsE2EAdmin(page);
    let denied = false;
    await page.route("**/api/admin/agents/changesets**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/validate")) {
        denied = true;
        await route.fulfill({
          status: 403,
          json: { error: { code: "FORBIDDEN", message: "Forbidden" }, status: 403 },
        });
        return;
      }
      if (denied) {
        await route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "Not found" }, status: 404 },
        });
        return;
      }
      await route.fulfill({
        json: url.pathname.endsWith(id)
          ? {
              schemaVersion: "np.agent-changeset-review.v1",
              rollbackDetail: null,
              rollbackActions: [],
              executionDetail: null,
              executionActions: [],
              changeSet: draft(),
              requiredStaffCapabilities: ["content.author"],
              operations: [{ ordinal: 1, evidence: "not_validated", fields: [] }],
            }
          : { schemaVersion: "np.agent-changesets.v1", items: [draft()], nextCursor: null },
      });
    });
    await page.goto("/admin/agents/changesets");
    await page.getByRole("link", { name: "Review fixture proposal", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Server facts" })).toBeVisible();
    await expect(
      page.getByText("<script>untrusted assessment</script>", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Diff evidence: not validated", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Generate preview", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Validate proposal", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "no longer have access" }),
    ).toBeVisible();
    await expect(
      page.getByText("<script>untrusted assessment</script>", { exact: true }),
    ).toHaveCount(0);
  });
  test("native launch forms pass the centralized staff CSRF check and retain same-origin intent", async ({
    page,
    context,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(context, 182 + testInfo.retry * 3);
    await signInAsE2EAdmin(page);
    await page.goto("/admin/agents/changesets");
    const endpoint = `/api/admin/agents/changesets/${id}/previews/${id}/launch`;
    const popupPromise = context.waitForEvent("page");
    await page.evaluate((endpoint) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("np-csrf="))
          ?.slice(8) ?? "";
      const form = document.createElement("form");
      form.method = "post";
      form.action = endpoint;
      form.target = "_blank";
      form.rel = "noopener";
      for (const [name, value] of Object.entries({
        command: "{}",
        csrfToken: decodeURIComponent(csrf),
      })) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
      form.remove();
    }, endpoint);
    const popup = await popupPromise;
    await popup.waitForLoadState();
    // No runtime is installed in the reference app; successful CSRF admission reaches its safe 404.
    await expect(popup.locator("body")).toContainText("Not found");
    await expect(popup.locator("body")).not.toContainText("CSRF_INVALID");
    await popup.close();
  });
});

test("execution actions use server authority, exact cancellation and stable retry", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(page.context(), 194 + testInfo.retry);
  await signInAsE2EAdmin(page);
  const commands: Record<string, unknown>[] = [];
  let available = true;
  let failNextRead = false;
  const review = () => ({
    schemaVersion: "np.agent-changeset-review.v1",
    rollbackDetail: null,
    rollbackActions: [],
    changeSet: draft(),
    requiredStaffCapabilities: ["content.author"],
    operations: [{ ordinal: 1, evidence: "not_validated", fields: [] }],
    executionDetail: null,
    executionActions: available ? ["cancel"] : [],
  });
  await page.route("**/api/admin/agents/changesets**", async (route) => {
    if (route.request().url().endsWith("/cancel")) {
      commands.push(route.request().postDataJSON());
      if (commands.length === 1) {
        failNextRead = true;
        await route.abort();
        return;
      }
      available = false;
    }
    if (route.request().method() === "GET" && failNextRead) {
      failNextRead = false;
      await route.fulfill({
        status: 503,
        json: { status: 503, error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" } },
      });
      return;
    }
    await route.fulfill({ json: review() });
  });
  await page.goto(`/admin/agents/changesets/${id}`);
  await expect(page.getByRole("button", { name: "Apply approved plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Schedule approved plan" })).toHaveCount(0);
  await page.getByLabel("Cancellation reason (optional)").fill("Withdraw proposal");
  await page.getByRole("button", { name: "Cancel ChangeSet", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be confirmed" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel ChangeSet", exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The ChangeSet response could not be loaded or validated." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByLabel("Cancellation reason (optional)").fill("Withdraw proposal");
  await page.getByRole("button", { name: "Cancel ChangeSet", exact: true }).click();
  await expect(page.getByText("No execution actions are currently available.")).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[0]).toEqual({
    schemaVersion: "np.agent-changeset-cancel-input.v1",
    expectedDraftVersion: 1,
    expectedState: "draft",
    planHash: null,
    reasonCode: "OPERATOR_CANCELLED",
    reason: "Withdraw proposal",
    idempotencyKey: expect.any(String),
  });
});

for (const operation of ["apply", "schedule"] as const) {
  test(`execution ${operation} binds the approved plan and clears evidence after reauthentication loss`, async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(
      page.context(),
      (operation === "apply" ? 197 : 200) + testInfo.retry,
    );
    await signInAsE2EAdmin(page);
    let command: Record<string, unknown> | null = null;
    const changeSet = {
      ...draft(),
      state: "approved",
      planHash: hash,
      baseFingerprint: hash,
      risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
      validation: {
        state: "valid",
        generation: 1,
        issueCount: 0,
        digest: hash,
        completedAt: "2026-09-08T00:00:00.000Z",
      },
      operations: draft().operations.map((row) => ({ ...row, state: "valid", afterHash: hash })),
      approval: {
        id,
        generation: 1,
        state: "approved",
        statementHash: hash,
        requiredHumanCapabilities: ["content.author"],
        requiredHumanPredicates: [],
        requestedAt: "2026-09-08T00:00:00.000Z",
        expiresAt: "2026-09-09T00:00:00.000Z",
        decidedAt: "2026-09-08T00:01:00.000Z",
      },
    };
    await page.route("**/api/admin/agents/changesets**", async (route) => {
      if (route.request().url().endsWith(`/${operation}`)) {
        command = route.request().postDataJSON();
        await route.fulfill({
          status: 403,
          json: {
            status: 403,
            error: { code: "RECENT_REAUTHENTICATION_REQUIRED", message: "Reauthenticate" },
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          schemaVersion: "np.agent-changeset-review.v1",
          rollbackDetail: null,
          rollbackActions: [],
          changeSet,
          requiredStaffCapabilities: ["content.author"],
          operations: [{ ordinal: 1, evidence: "available", fields: [] }],
          executionDetail: null,
          executionActions: [operation],
        },
      });
    });
    await page.goto(`/admin/agents/changesets/${id}`);
    if (operation === "schedule")
      await page.getByLabel("Approved schedule time (local time)").fill("2026-09-08T01:00");
    const expectedTime = await page.evaluate(() => new Date("2026-09-08T01:00").toISOString());
    await page
      .getByRole("button", {
        name: operation === "apply" ? "Apply approved plan" : "Schedule approved plan",
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Recent staff-primary reauthentication is required" }),
    ).toBeVisible();
    await expect(page.getByText("Review fixture proposal", { exact: true })).toHaveCount(0);
    expect(command).toEqual({
      schemaVersion: `np.agent-changeset-${operation}-input.v1`,
      expectedDraftVersion: 1,
      planHash: hash,
      approvalId: id,
      statementHash: hash,
      idempotencyKey: expect.any(String),
      ...(operation === "schedule" ? { scheduledFor: expectedTime } : {}),
    });
  });
}

for (const action of ["prepare", "request_approval", "execute", "cancel"] as const) {
  test(`rollback ${action} uses exact current bindings and removes stale evidence`, async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(
      page.context(),
      (action === "prepare"
        ? 220
        : action === "request_approval"
          ? 223
          : action === "execute"
            ? 226
            : 229) + testInfo.retry,
    );
    await signInAsE2EAdmin(page);
    const at = "2026-09-08T00:00:00.000Z";
    const restoredTitle = `<script>Restored title</script> ${"되돌리기검증용긴문서제목".repeat(12)}`;
    const approval = {
      id,
      generation: 1,
      state: "approved",
      statementHash: hash,
      requiredHumanCapabilities: ["content.publish"],
      requiredHumanPredicates: [],
      requestedAt: at,
      expiresAt: "2026-09-09T00:00:00.000Z",
      decidedAt: "2026-09-08T00:01:00.000Z",
    };
    const summary = {
      rollbackPlanId: id,
      generation: 1,
      state: action === "execute" ? "approved" : "ready",
      planHash: hash,
      approvalId: action === "execute" ? id : null,
      operationCount: 1,
      createdAt: at,
      expiresAt: "2026-09-08T01:00:00.000Z",
      finishedAt: null,
      terminalReason: null,
    };
    const rollbackDetail =
      action === "prepare"
        ? null
        : {
            schemaVersion: "np.agent-rollback-detail.v1",
            changeSetId: id,
            summary,
            version: 2,
            compensatesExecutionId: id,
            originalPlanHash: hash,
            appliedResultDigest: hash,
            baseFingerprint: hash,
            risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
            requiredScopes: ["changeset:apply"],
            requiredHumanCapabilities: ["content.publish"],
            requiredHumanPredicates: [],
            policyHashes: [],
            operations: [
              {
                review: {
                  ordinal: 1,
                  evidence: "available",
                  fields: [
                    {
                      path: "title",
                      before: { presence: "present", value: "Applied" },
                      after: { presence: "present", value: restoredTitle },
                    },
                  ],
                },
                originalOperationOrdinal: 1,
                rollbackClass: "full",
                residualCodes: [],
              },
            ],
            approval: action === "execute" ? approval : null,
            execution: null,
            verification: null,
            checks: [],
          };
    const changeSet = {
      ...draft(),
      state: "applied",
      planHash: hash,
      baseFingerprint: hash,
      risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
      validation: { state: "valid", generation: 1, issueCount: 0, digest: hash, completedAt: at },
      operations: draft().operations.map((op) => ({
        ...op,
        state: "applied",
        afterHash: hash,
        resultDigest: hash,
      })),
      execution: {
        executionId: id,
        state: "committed",
        resultDigest: hash,
        startedAt: at,
        finishedAt: null,
      },
      rollback: rollbackDetail ? summary : null,
    };
    let posted: Record<string, unknown> | null = null;
    const attempts: Record<string, unknown>[] = [];
    await page.route("**/api/admin/agents/changesets**", async (route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON();
        attempts.push(posted!);
        if (action === "execute" && attempts.length === 1) {
          await route.abort();
          return;
        }
        await route.fulfill({
          status: 409,
          json: { status: 409, error: { code: "CONFLICT", message: "Changed" } },
        });
        return;
      }
      await route.fulfill({
        json: {
          schemaVersion: "np.agent-changeset-review.v1",
          changeSet,
          requiredStaffCapabilities: ["content.publish"],
          operations: [{ ordinal: 1, evidence: "available", fields: [] }],
          executionDetail: null,
          executionActions: [],
          rollbackDetail,
          rollbackActions: [action],
        },
      });
    });
    await page.goto(`/admin/agents/changesets/${id}`);
    if (action !== "prepare")
      await expect(
        page.getByText(`After: ${JSON.stringify(restoredTitle)}`, { exact: true }),
      ).toBeVisible();
    const labels = {
      prepare: "Prepare rollback plan",
      request_approval: "Request rollback approval",
      execute: "Execute approved rollback",
      cancel: "Cancel rollback plan",
    };
    for (const other of ["prepare", "request_approval", "execute", "cancel"] as const)
      if (other !== action)
        await expect(page.getByRole("button", { name: labels[other], exact: true })).toHaveCount(0);
    const control = page.getByRole("button", { name: labels[action], exact: true });
    // Distribute responsive/theme checks across the existing binding cases.
    const width =
      action === "prepare" || action === "execute" ? 320 : action === "cancel" ? 768 : 1280;
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({
      colorScheme: action === "execute" || action === "cancel" ? "dark" : "light",
      reducedMotion: "reduce",
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    if (action !== "prepare") {
      const facts = page.getByRole("region", { name: "Rollback plan facts" });
      await expect(facts).toBeVisible();
      const bounds = await facts.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    const screenshot = testInfo.outputPath(`rollback-${action}-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    await testInfo.attach(`rollback-${action}-${width}`, {
      path: screenshot,
      contentType: "image/png",
    });
    await tabTo(page, control);
    await page.keyboard.press("Enter");
    if (action === "execute") {
      await expect(
        page.getByRole("alert").filter({ hasText: "Rollback request could not be confirmed" }),
      ).toBeVisible();
      await tabTo(page, page.getByRole("button", { name: "Refresh", exact: true }));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: "Rollback plan facts" })).toBeVisible();
      await tabTo(page, control);
      await page.keyboard.press("Enter");
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
    }
    await expect(
      page.getByRole("alert").filter({ hasText: "Rollback request could not be confirmed" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Rollback plan facts" })).toHaveCount(0);
    expect(posted).toEqual(
      action === "cancel"
        ? {
            schemaVersion: "np.agent-changeset-cancel-input.v1",
            targetKind: "rollback_plan",
            rollbackPlanId: id,
            expectedRollbackVersion: 2,
            expectedDraftVersion: 1,
            expectedState: "ready",
            planHash: hash,
            reasonCode: "OPERATOR_CANCELLED",
            reason: null,
            idempotencyKey: expect.any(String),
          }
        : {
            schemaVersion: `np.agent-rollback-plan-${action === "prepare" ? "create" : action === "request_approval" ? "request-approval" : "execute"}-input.v1`,
            expectedVersion: action === "prepare" ? 1 : 2,
            planHash: hash,
            idempotencyKey: expect.any(String),
            ...(action === "execute" ? { approvalId: id, statementHash: hash } : {}),
          },
    );
  });
}

test("ChangeSets delayed bounded queue remains readable across viewports", async ({
  page,
}, testInfo) => {
  let release = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const items = Array.from({ length: 25 }, (_, index) => {
    const rowId = `21111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`;
    return {
      ...draft(),
      id: rowId,
      title: `한국어 검토 제안과 긴 변경 사항 설명 ${index + 1} `.repeat(3),
    };
  });
  await page.route("**/api/admin/agents/changesets", async (route) => {
    await gate;
    await route.fulfill({
      json: { schemaVersion: "np.agent-changesets.v1", items, nextCursor: null },
    });
  });
  await signInAsE2EAdmin(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/agents/changesets");
  await expect(page.getByRole("status").filter({ hasText: "Loading ChangeSets" })).toBeVisible();
  await expect(page.locator('[aria-hidden="true"] .h-24')).toBeVisible();
  release();
  const rows = page.getByRole("link", { name: /한국어 검토 제안/ });
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
        path: testInfo.outputPath(`changesets-${width}-${theme}.png`),
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

test("rollback succeeds through preparation, human approval and verified compensation", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    246 + testInfo.retry + testInfo.repeatEachIndex * 2,
  );
  await signInAsE2EAdmin(page);
  const planId = "31111111-1111-4111-8111-111111111111";
  const approvalId = "41111111-1111-4111-8111-111111111111";
  const executionId = "51111111-1111-4111-8111-111111111111";
  const rollbackHash = `cj1:sha256:${"b".repeat(43)}`;
  const statementHash = `cj1:sha256:${"c".repeat(43)}`;
  const at = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const code = `${"R".repeat(42)}Q`;
  const challengeOutput = npRequireAgentApprovalChallengeOutputV1({
    schemaVersion: "np.agent-approval-challenge.v1",
    approvalId,
    approvalVersion: 2,
    purpose: "approve",
    challengeGeneration: 1,
    challenge: code,
    reauthentication: { mode: "none" },
    expiresAt,
  });
  let stage = 0;
  let approvalVersion = 1;
  const commands: { path: string; body: Record<string, unknown> }[] = [];
  let release = () => {};
  let gate: Promise<void>;
  function hold() {
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  }
  function approval() {
    return {
      id: approvalId,
      generation: 1,
      state: stage === 4 ? "consumed" : stage === 3 ? "approved" : "pending",
      statementHash,
      requiredHumanCapabilities: ["content.publish"],
      requiredHumanPredicates: [],
      requestedAt: at,
      expiresAt,
      decidedAt: stage >= 3 ? at : null,
    };
  }
  function review() {
    const summary = {
      rollbackPlanId: planId,
      generation: 1,
      state:
        stage === 4
          ? "verified"
          : stage === 3
            ? "approved"
            : stage === 2
              ? "approval_pending"
              : "ready",
      planHash: rollbackHash,
      approvalId: stage >= 2 ? approvalId : null,
      operationCount: 1,
      createdAt: at,
      expiresAt,
      finishedAt: stage === 4 ? at : null,
      terminalReason: null,
    };
    return npRequireAgentChangeSetReviewV1({
      schemaVersion: "np.agent-changeset-review.v1",
      changeSet: {
        ...draft(),
        state: stage === 4 ? "rolled_back" : "applied",
        planHash: hash,
        baseFingerprint: hash,
        risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
        validation: { state: "valid", generation: 1, issueCount: 0, digest: hash, completedAt: at },
        operations: draft().operations.map((op) => ({
          ...op,
          state: "applied",
          afterHash: hash,
          resultDigest: hash,
        })),
        execution: {
          executionId: id,
          state: "succeeded",
          resultDigest: hash,
          startedAt: at,
          finishedAt: at,
        },
        rollback: stage > 0 ? summary : null,
        createdAt: at,
        updatedAt: at,
        expiresAt,
      },
      requiredStaffCapabilities: ["content.publish"],
      operations: [{ ordinal: 1, evidence: "available", fields: [] }],
      executionDetail: null,
      executionActions: [],
      rollbackActions:
        stage === 0
          ? ["prepare"]
          : stage === 1
            ? ["request_approval", "cancel"]
            : stage === 3
              ? ["execute", "cancel"]
              : [],
      rollbackDetail:
        stage === 0
          ? null
          : {
              schemaVersion: "np.agent-rollback-detail.v1",
              changeSetId: id,
              summary: { ...summary },
              version: stage + 1,
              compensatesExecutionId: id,
              originalPlanHash: hash,
              appliedResultDigest: hash,
              baseFingerprint: rollbackHash,
              risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
              requiredScopes: ["changeset:apply"],
              requiredHumanCapabilities: ["content.publish"],
              requiredHumanPredicates: [],
              policyHashes: [],
              operations: [
                {
                  review: {
                    ordinal: 1,
                    evidence: "available",
                    fields: [
                      {
                        path: "title",
                        before: { presence: "present", value: "Applied title" },
                        after: { presence: "present", value: "Original title" },
                      },
                    ],
                  },
                  originalOperationOrdinal: 1,
                  rollbackClass: "full",
                  residualCodes: [],
                },
              ],
              approval: stage >= 2 ? approval() : null,
              execution:
                stage === 4
                  ? {
                      executionId,
                      state: "succeeded",
                      resultDigest: rollbackHash,
                      startedAt: at,
                      finishedAt: at,
                    }
                  : null,
              verification:
                stage === 4
                  ? {
                      state: "passed",
                      requiredPassed: 1,
                      requiredFailed: 0,
                      advisoryWarnings: 0,
                      digest: rollbackHash,
                      completedAt: at,
                    }
                  : null,
              checks: [],
            },
    });
  }
  function approvalDetail() {
    return npRequireAgentApprovalDetailV1({
      schemaVersion: "np.agent-approval-detail.v1",
      review: null,
      rollbackReview: review().rollbackDetail,
      item: {
        schemaVersion: "np.agent-approval-list-item.v1",
        approval: approval(),
        version: approvalVersion,
        target: {
          kind: "changeset_rollback",
          changeSetId: id,
          rollbackPlanId: planId,
          planHash: rollbackHash,
        },
        intendedOperation: null,
        scheduledFor: null,
        statementHash,
        reauthentication: { mode: "none" },
        allowedDecisions:
          stage === 2 ? ["approve", "reject", "revoke"] : stage === 3 ? ["revoke"] : [],
        risk: "reversible",
        capabilityId: "changeset.rollback",
        capabilityContractVersion: 1,
        capabilityFingerprint: hash,
        policyHashes: [],
        requiresLivePreview: false,
        reviewSummary: {
          operationCount: 1,
          targetCount: 1,
          previewState: null,
          checksRun: null,
          rollbackPlan: "available",
        },
        requiredScopes: ["changeset:apply"],
        requester: { kind: "staff", id },
      },
    });
  }
  // Validate every server projection before navigation, including terminal evidence.
  for (stage = 0; stage <= 4; stage++) {
    review();
    if (stage >= 2) approvalDetail();
  }
  stage = 0;
  const unexpectedRequests: string[] = [];
  await page.route("**/api/admin/agents/**", async (route) => {
    unexpectedRequests.push(
      `${route.request().method()} ${new URL(route.request().url()).pathname}`,
    );
    await route.abort();
  });
  await page.route("**/api/admin/agents/changesets/**", async (route) => {
    if (route.request().method() === "POST") {
      const path = new URL(route.request().url()).pathname;
      commands.push({ path, body: route.request().postDataJSON() });
      await gate;
      if (path.endsWith("/request-approval")) {
        stage = 2;
        await route.fulfill({ json: approvalDetail() });
      } else {
        stage = path.endsWith("/execute") ? 4 : 1;
        await route.fulfill({ json: review() });
      }
    } else await route.fulfill({ json: review() });
  });
  await page.route("**/api/admin/agents/approvals/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "POST") {
      await route.fulfill({ json: approvalDetail() });
      return;
    }
    commands.push({ path, body: route.request().postDataJSON() });
    if (path.endsWith("/decision-challenge")) {
      approvalVersion = 2;
      await route.fulfill({ json: challengeOutput });
    } else {
      await gate;
      stage = 3;
      approvalVersion = 3;
      await route.fulfill({ json: approvalDetail() });
    }
  });
  await page.goto(`/admin/agents/changesets/${id}`);
  const facts = page.getByRole("region", { name: "Rollback plan facts" });
  const prepare = page.getByRole("button", { name: "Prepare rollback plan", exact: true });
  hold();
  await tabTo(page, prepare);
  await page.keyboard.press("Enter");
  await expect.poll(() => commands.length).toBe(1);
  await expect(prepare).toBeDisabled();
  await expect(facts).toHaveCount(0);
  await page.keyboard.press("Enter");
  expect(commands).toHaveLength(1);
  release();
  await expect(facts.getByRole("heading", { name: "Compensation plan · ready" })).toBeVisible();
  await expect(prepare).toHaveCount(0);
  await agentLifecycleCheckpoint(page, "rollback-prepared");
  const request = page.getByRole("button", { name: "Request rollback approval", exact: true });
  hold();
  await tabTo(page, request);
  await page.keyboard.press("Enter");
  await expect.poll(() => commands.length).toBe(2);
  await expect(request).toBeDisabled();
  await expect(page.getByRole("link", { name: /Review rollback approval/ })).toHaveCount(0);
  release();
  const approvalLink = page.getByRole("link", {
    name: "Review rollback approval · pending",
    exact: true,
  });
  await expect(approvalLink).toBeVisible();
  await expect(request).toHaveCount(0);
  await tabTo(page, approvalLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/admin/agents/approvals/${approvalId}$`));
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await tabTo(page, approve);
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("button", { name: "Confirm approve", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Type this one-time confirmation value").fill(code);
  await page.getByLabel("Human reason (optional)").fill("Reviewed original title compensation");
  hold();
  await tabTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect.poll(() => commands.length).toBe(4);
  await expect(confirm).toBeDisabled();
  await expect(page.getByText("approved", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Enter");
  expect(commands).toHaveLength(4);
  release();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(approve).toHaveCount(0);
  await agentLifecycleCheckpoint(page, "rollback-approved");
  await page.goto(`/admin/agents/changesets/${id}`);
  const execute = page.getByRole("button", { name: "Execute approved rollback", exact: true });
  await expect(facts.getByRole("heading", { name: "Compensation plan · approved" })).toBeVisible();
  hold();
  await tabTo(page, execute);
  await page.keyboard.press("Enter");
  await expect.poll(() => commands.length).toBe(5);
  await expect(execute).toBeDisabled();
  await expect(facts.getByRole("heading", { name: "Compensation plan · verified" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  expect(commands).toHaveLength(5);
  release();
  await expect(facts.getByRole("heading", { name: "Compensation plan · verified" })).toBeVisible();
  await expect(facts.getByText("succeeded", { exact: true })).toBeVisible();
  await expect(facts.getByText("passed", { exact: true })).toBeVisible();
  await expect(page.getByText("rolled_back", { exact: true })).toBeVisible();
  for (const name of [
    "Prepare rollback plan",
    "Request rollback approval",
    "Execute approved rollback",
    "Cancel rollback plan",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Review rollback approval · consumed", exact: true }),
  ).toBeVisible();
  await agentLifecycleCheckpoint(page, "rollback-verified");
  const screenshot = testInfo.outputPath("rollback-verified.png");
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  await testInfo.attach("rollback-verified", { path: screenshot, contentType: "image/png" });
  expect(unexpectedRequests).toEqual([]);
  expect(commands.map(({ path }) => path)).toEqual([
    `/api/admin/agents/changesets/${id}/rollback-plans`,
    `/api/admin/agents/changesets/${id}/rollback-plans/${planId}/request-approval`,
    `/api/admin/agents/approvals/${approvalId}/decision-challenge`,
    `/api/admin/agents/approvals/${approvalId}/approve`,
    `/api/admin/agents/changesets/${id}/rollback-plans/${planId}/execute`,
  ]);
  expect(commands[0].body).toEqual({
    schemaVersion: "np.agent-rollback-plan-create-input.v1",
    expectedVersion: 1,
    planHash: hash,
    idempotencyKey: expect.any(String),
  });
  expect(commands[1].body).toEqual({
    schemaVersion: "np.agent-rollback-plan-request-approval-input.v1",
    expectedVersion: 2,
    planHash: rollbackHash,
    idempotencyKey: expect.any(String),
  });
  expect(commands[2].body).toEqual({
    schemaVersion: "np.agent-approval-challenge-request.v1",
    expectedApprovalVersion: 1,
    statementHash,
    purpose: "approve",
    idempotencyKey: expect.any(String),
  });
  expect(commands[3].body).toEqual({
    schemaVersion: "np.agent-approval-decision-input.v1",
    expectedApprovalVersion: 2,
    statementHash,
    challengeGeneration: 1,
    challenge: code,
    reason: "Reviewed original title compensation",
    idempotencyKey: expect.any(String),
  });
  expect(commands[4].body).toEqual({
    schemaVersion: "np.agent-rollback-plan-execute-input.v1",
    expectedVersion: 4,
    planHash: rollbackHash,
    approvalId,
    statementHash,
    idempotencyKey: expect.any(String),
  });
});

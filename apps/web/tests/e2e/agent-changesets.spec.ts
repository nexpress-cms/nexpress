import { expect, test } from "@playwright/test";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
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
        await route.abort();
        return;
      }
      available = false;
    }
    await route.fulfill({ json: review() });
  });
  await page.goto(`/admin/agents/changesets/${id}`);
  await expect(page.getByRole("button", { name: "Apply approved plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Schedule approved plan" })).toHaveCount(0);
  await page.getByLabel("Cancellation reason (optional)").fill("Withdraw proposal");
  await page.getByRole("button", { name: "Cancel ChangeSet", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be confirmed" })).toBeVisible();
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
                      after: { presence: "present", value: "<script>Restored title</script>" },
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
    await page.route("**/api/admin/agents/changesets**", async (route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON();
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
        page.getByText('After: "<script>Restored title</script>"', { exact: true }),
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
    await page.getByRole("button", { name: labels[action], exact: true }).click();
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

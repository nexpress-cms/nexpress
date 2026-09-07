import { expect, test } from "@playwright/test";

import { signInViaForm } from "./fixtures/auth-helpers.js";

test.describe("Agent Studio without a host runtime", () => {
  test("requires staff sign-in and keeps disabled MCP discovery private", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/agents");
    await expect(page).toHaveURL(/\/admin\/login/);
    for (const path of ["/api/mcp", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(404);
    }
  });

  test("shows honest unavailable and empty states across outbound and inbound connections", async ({
    page,
  }) => {
    await signInViaForm(page);
    await page.goto("/admin/agents/connections");
    await expect(
      page.getByRole("status").filter({ hasText: "Agent control-plane mutations are disabled" }),
    ).toBeVisible();
    await expect(
      page.getByText("No provider connections for this site.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Gateway inbound" }).click();
    await expect(
      page.getByText("No external Gateway principals for this site.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create principal", exact: true }),
    ).toBeDisabled();
  });
});

test.describe("Agent Activity", () => {
  test("keeps unavailable history distinct from an empty list", async ({ page }) => {
    await signInViaForm(page);
    for (const operation of ["suspend", "resume", "revoke"]) {
      const response = await page.request.post(
        `/api/admin/agents/gateway/principals/11111111-1111-4111-8111-111111111111/${operation}`,
        {
          headers: { "x-csrf-token": "invalid" },
          data: {},
        },
      );
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
    }
    await page.goto("/admin/agents/activity");
    await expect(
      page.getByRole("status").filter({ hasText: "Agent Activity is unavailable." }),
    ).toBeVisible();
    await expect(page.getByText("No Agent runs match these filters.", { exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("link", { name: "Actions", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Agent Activity is unavailable." }),
    ).toBeVisible();
  });

  test("filters and pages inline actions, shows expired evidence, and clears access-lost data", async ({
    page,
  }) => {
    const id = "44444444-4444-4444-8444-444444444444";
    const principalId = "11111111-1111-4111-8111-111111111111";
    const digest = `cj1:sha256:${"A".repeat(43)}`;
    let denied = false;
    const detail = {
      schemaVersion: "np.agent-activity-action.v1",
      principalId,
      invocationId: "22222222-2222-4222-8222-222222222222",
      inputHash: digest,
      outputHash: digest,
      auditEventId: null,
      evidence: "expired",
      action: {
        schemaVersion: "np.agent-action-projection.v1",
        id,
        siteId: "default",
        runId: null,
        sequence: 1,
        capabilityId: "site.inspect",
        capabilityContractVersion: 1,
        capabilityFingerprint: digest,
        effectProfile: { id: "site.inspect.read", contractVersion: 1 },
        risk: "read",
        state: "succeeded",
        inputRedacted: {},
        outputRedacted: {},
        requiredScopes: ["site:read"],
        targetRefs: [],
        proposalHash: digest,
        approvalId: null,
        verificationState: null,
        errorCode: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        startedAt: "2026-09-01T00:00:01.000Z",
        finishedAt: "2026-09-01T00:00:02.000Z",
      },
    };
    const requested: string[] = [];
    await page.route("**/api/admin/agents/activity/actions**", async (route) => {
      const url = new URL(route.request().url());
      requested.push(url.search);
      if (url.pathname.endsWith(`/${id}`)) {
        await route.fulfill({
          status: denied ? 403 : 200,
          json: denied
            ? {
                status: 403,
                error: { code: "ACTIVITY_FORBIDDEN", message: "Activity permission is required." },
              }
            : detail,
        });
      } else {
        await route.fulfill({
          json: {
            schemaVersion: "np.agent-activity-actions.v1",
            items: [detail],
            nextCursor: url.searchParams.has("cursor") ? null : "opaque-activity-cursor",
          },
        });
      }
    });
    await signInViaForm(page);
    await page.goto("/admin/agents/activity/actions");
    await expect(page.getByRole("link", { name: /site.inspect/ })).toBeVisible();
    await page.getByLabel("Principal ID", { exact: true }).fill(principalId);
    await page.getByLabel("State", { exact: true }).selectOption("succeeded");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page).toHaveURL(/principalId=/);
    await expect
      .poll(() =>
        requested.some(
          (query) =>
            query.includes(`principalId=${principalId}`) && query.includes("state=succeeded"),
        ),
      )
      .toBe(true);
    await page.getByRole("link", { name: "Next page", exact: true }).click();
    await expect(page).toHaveURL(/cursor=opaque-activity-cursor/);
    await expect(page.getByRole("link", { name: "First page", exact: true })).toBeVisible();
    await page.getByRole("link", { name: /site.inspect/ }).click();
    await expect(page.getByRole("heading", { name: "site.inspect", exact: true })).toBeVisible();
    await expect(
      page.getByText("Inline invocation · no run was created", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Evidence has expired.", { exact: false })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Safe evidence projection", exact: true }),
    ).toHaveCount(0);
    denied = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "You do not have access to this Activity." }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "site.inspect", exact: true })).toHaveCount(0);
    await expect(page.getByText(digest, { exact: true })).toHaveCount(0);
  });

  test("uses a reviewed reason and fresh versions for principal suspension, resumption, and revocation", async ({
    page,
  }) => {
    const id = "11111111-1111-4111-8111-111111111111";
    const principal = {
      schemaVersion: "np.agent-principal.v1",
      id,
      siteId: "default",
      kind: "external",
      name: "Activity principal fixture",
      description: null,
      status: "active",
      scopes: ["site:read"],
      authority: {
        kind: "user",
        userId: "22222222-2222-4222-8222-222222222222",
        fingerprint: `cj1:sha256:${"A".repeat(43)}`,
        deletedAt: null,
      },
      rowVersion: 1,
      tokenVersion: 1,
      autonomy: null,
      gatewayExposureCeiling: "read",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      revokedAt: null as string | null,
    };
    const commands: Array<Record<string, unknown>> = [];
    await page.route(`**/api/admin/agents/gateway/principals/${id}**`, async (route) => {
      const operation = new URL(route.request().url()).pathname.split("/").at(-1);
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: { schemaVersion: "np.agent-studio-principal-detail.v1", principal, tokens: [] },
        });
      } else {
        const command = route.request().postDataJSON() as Record<string, unknown>;
        commands.push(command);
        expect(command.expectedVersion).toBe(principal.rowVersion);
        expect(command.idempotencyKey).toEqual(expect.any(String));
        principal.status =
          operation === "suspend" ? "suspended" : operation === "resume" ? "active" : "revoked";
        principal.rowVersion++;
        principal.tokenVersion++;
        principal.updatedAt = "2026-09-01T01:00:00.000Z";
        principal.revokedAt = operation === "revoke" ? principal.updatedAt : null;
        await route.fulfill({ json: principal });
      }
    });
    await signInViaForm(page);
    await page.goto(`/admin/agents/gateway/${id}`);
    await page.getByRole("button", { name: "Suspend principal", exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Review access");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Resume principal", exact: true }).click();
    await expect(page.getByLabel("Reason", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Revoke principal", exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Retire access");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("button", { name: "Revoke principal", exact: true })).toHaveCount(
      0,
    );
    expect(commands.map((command) => command.expectedVersion)).toEqual([1, 2, 3]);
    expect(commands.map((command) => command.reason)).toEqual([
      "Review access",
      undefined,
      "Retire access",
    ]);
    expect(new Set(commands.map((command) => command.idempotencyKey)).size).toBe(3);
  });
});

test("Agent Activity shows recorded Gateway and Runtime facts without inventing an Agent", async ({
  page,
}) => {
  const gatewayId = "33333333-3333-4333-8333-333333333333";
  const runtimeId = "66666666-6666-4666-8666-666666666666";
  const agentId = "44444444-4444-4444-8444-444444444444";
  const makeRun = (origin: "gateway" | "runtime") => {
    const id = origin === "gateway" ? gatewayId : runtimeId;
    return {
      schemaVersion: "np.agent-activity-run.v1",
      invocationId: null,
      evidence: "redacted",
      auditEventIds: [],
      run: {
        schemaVersion: "np.agent-run.v1",
        id,
        siteId: "default",
        origin,
        agent:
          origin === "runtime"
            ? { id: agentId, versionId: "55555555-5555-4555-8555-555555555555" }
            : null,
        principalId: "11111111-1111-4111-8111-111111111111",
        rootRunId: id,
        parentRunId: null,
        causalDepth: 0,
        state: "succeeded",
        goal: `[redacted ${origin} fixture]`,
        runLimits: {
          schemaVersion: "np.agent-run-limits.v1",
          maxAttempts: 2,
          maxProviderCalls: 4,
          maxCapabilityCalls: 8,
          maxInputTokens: 10000,
          maxOutputTokens: 2000,
          maxCostMicros: 500000,
          maxWallClockSeconds: 300,
        },
        usage: {
          providerCalls: origin === "runtime" ? 1 : 0,
          capabilityCalls: 2,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          costMicros: 0,
        },
        attempt: 1,
        errorCode: null,
        errorMessage: null,
        queuedAt: "2026-09-01T00:00:00.000Z",
        deadlineAt: "2026-09-01T00:05:00.000Z",
        startedAt: "2026-09-01T00:00:01.000Z",
        finishedAt: "2026-09-01T00:00:02.000Z",
      },
    };
  };
  const records = [makeRun("gateway"), makeRun("runtime")];
  await page.route("**/api/admin/agents/activity**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/actions"))
      await route.fulfill({
        json: { schemaVersion: "np.agent-activity-actions.v1", items: [], nextCursor: null },
      });
    else {
      const detail = records.find(({ run }) => path.endsWith(`/${run.id}`));
      await route.fulfill({
        json: detail ?? {
          schemaVersion: "np.agent-activity-runs.v1",
          items: records,
          nextCursor: null,
        },
      });
    }
  });
  await signInViaForm(page);
  await page.goto("/admin/agents/activity");
  await page.getByRole("link", { name: /redacted gateway fixture/ }).click();
  await expect(
    page.getByRole("heading", { name: "[redacted gateway fixture]", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Gateway", { exact: true })).toBeVisible();
  await expect(page.getByText("Provider calls", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Agent version", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No visible actions for this run.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Runs", exact: true }).click();
  await page.getByRole("link", { name: /redacted runtime fixture/ }).click();
  await expect(
    page.getByRole("heading", { name: "[redacted runtime fixture]", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Runtime", { exact: true })).toBeVisible();
  await expect(page.getByText("Provider calls", { exact: true })).toBeVisible();
  await expect(page.getByText("Agent version", { exact: true })).toBeVisible();
  await expect(page.getByText(agentId, { exact: true })).toBeVisible();
});

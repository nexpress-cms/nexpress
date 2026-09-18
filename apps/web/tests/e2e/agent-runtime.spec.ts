import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  npCreateInheritedAgentBudgetV1,
  npBuildAgentPolicySimulationFixtureInputV1,
  npSimulateAgentPolicyV1,
  npCreateDisabledAgentRuntimeSettingsV1,
} from "@nexpress/core/agent-contract";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

/** Exercise the real tab order, including intervening controls; never assign DOM focus. */
async function tabTo(page: Page, control: Locator) {
  for (let steps = 0; steps < 60; steps++) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
}

const id = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const principalId = "33333333-3333-4333-8333-333333333333";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const at = "2026-09-14T00:00:00.000Z";
const budget = npCreateInheritedAgentBudgetV1();
const definition = {
  schemaVersion: "np.agent-configuration-definition.v1",
  name: "Worker observer",
  template: "operator",
  modelConnectionId: null,
  model: null,
  scopes: ["site:read"],
  autonomy: "observe",
  capabilityModes: [{ capabilityId: "site.inspect", mode: "observe" }],
  policyMode: "site",
  budget,
  settings: [
    {
      recipeId: "operator.worker-not-draining",
      recipeVersion: 1,
      staleAfterSeconds: 60,
      minimumPendingJobs: 1,
      checkIds: ["jobs.worker"],
    },
  ],
};
const agent = {
  schemaVersion: "np.agent-configuration.v1",
  id,
  principalId,
  status: "draft",
  rowVersion: 1,
  versionId,
  version: 1,
  versionStatus: "draft",
  activeVersion: null,
  draftVersionId: versionId,
  manualRecipeIds: [],
  configHash: digest,
  definition,
  availableActions: [
    "agents.configurations.activate",
    "agents.configurations.archive",
    "agents.configurations.update",
  ],
  createdAt: at,
  updatedAt: at,
};
const readiness = {
  doctor: "ready",
  policy: "ready",
  budget: "ready",
  vault: "not-required",
  integrityKey: "ready",
  worker: "ready",
};
const catalog = {
  schemaVersion: "np.agent-runtime-catalog.v1",
  recipes: [
    {
      id: "operator.worker-not-draining",
      version: 1,
      allowedTemplates: ["operator"],
      providerMode: "forbidden",
      triggerKinds: ["manual"],
      capabilityIds: ["site.inspect"],
    },
  ],
  scopes: ["site:read"],
  connections: [],
  capabilities: [{ id: "site.inspect", modes: ["observe"] }],
  effectiveBudget: budget,
  defaultPolicyRules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
  selfDelegation: { userId: principalId },
};

test("Runtime management stays unavailable without a host and new writes retain CSRF", async ({
  page,
}) => {
  await signInAsE2EAdmin(page);
  for (const path of ["configurations", "policies", "budgets"]) {
    await page.goto(`/admin/agents/${path}`);
    await expect(page.getByRole("alert").filter({ hasText: "unavailable" }).first()).toContainText(
      "unavailable",
    );
  }
  const response = await page.request.post(`/api/admin/agents/configurations/${id}/activate`, {
    headers: { "x-csrf-token": "invalid" },
    data: {},
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
});

test("Runtime Agent filtering and activation keep the reviewed version and trigger plan", async ({
  page,
}) => {
  const requests: string[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/admin/agents/capabilities", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/admin/agents/triggers?**", (route) =>
    route.fulfill({
      json: { schemaVersion: "np.agent-triggers-page.v1", items: [], nextCursor: null },
    }),
  );
  await page.route("**/api/admin/agents/configurations**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 409,
        json: { status: 409, error: { code: "CONFLICT", message: "Resource changed." } },
      });
    } else if (url.pathname.endsWith("/effective")) {
      await route.fulfill({
        json: {
          schemaVersion: "np.agent-effective-config.v1",
          id,
          rowVersion: 1,
          versionId,
          configHash: digest,
          ready: true,
          blockers: [],
          policyRefs: [],
          readiness,
        },
      });
    } else if (url.pathname.endsWith(`/${id}`)) await route.fulfill({ json: agent });
    else {
      requests.push(url.search);
      await route.fulfill({
        json: {
          schemaVersion: "np.agent-configurations-page.v1",
          items: [agent],
          nextCursor: null,
        },
      });
    }
  });
  await signInAsE2EAdmin(page);
  await page.goto("/admin/agents/configurations");
  await page.getByLabel("Agent name", { exact: true }).fill("Worker");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect.poll(() => requests.some((query) => query.includes("name=Worker"))).toBe(true);
  await page.getByRole("link", { name: "Worker observer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Activate reviewed version", exact: true }),
  ).toBeDisabled();
  await tabTo(
    page,
    page.getByRole("button", { name: "Review effective configuration", exact: true }),
  );
  await page.keyboard.press("Enter");
  const activate = page.getByRole("button", { name: "Activate reviewed version", exact: true });
  await expect(activate).toBeEnabled();
  await tabTo(page, activate);
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "Add manual trigger", exact: true }));
  await page.keyboard.press("Enter");
  const enableTrigger = page.getByLabel("Enable after activation", { exact: true });
  await tabTo(page, enableTrigger);
  await page.keyboard.press("Space");
  await expect(enableTrigger).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: "Confirm", exact: true }));
  await page.keyboard.press("Enter");
  await expect(
    page.locator("form").getByRole("alert").filter({ hasText: "This resource changed." }),
  ).toContainText("changed");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    expectedVersion: 1,
    configHash: digest,
    reviewedPolicyRefs: [],
    triggers: [{ definition: { type: "manual" }, enabled: true }],
  });
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
});

test("Runtime budget and operations show unknown measurements without inventing zero", async ({
  page,
}) => {
  await page.route("**/api/admin/agents/budgets", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "np.agent-runtime-budget.v1",
        rowVersion: 1,
        deploymentCeiling: budget,
        siteCeiling: budget,
        effectiveCeiling: budget,
        measurement: "unavailable",
        usage: null,
      },
    }),
  );
  await page.route("**/api/admin/agents/runtime-status", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "np.agent-runtime-overview.v1",
        status: {
          schemaVersion: "np.agent-runtime-status.v1",
          siteId: "default",
          revision: 1,
          enabled: true,
          paused: true,
          readiness: { ...readiness, budget: "unavailable" },
          generatedAt: at,
        },
        operations: null,
      },
    }),
  );
  await signInAsE2EAdmin(page);
  await page.goto("/admin/agents/budgets");
  await expect(
    page.getByText("Measurement unavailable; configured hard limits fail closed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review site Runtime resume", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Operations evidence is unavailable. Counts are unknown.", { exact: true }),
  ).toBeVisible();
});

test("Runtime typed draft creation requires explicit self-delegation and never activates implicitly", async ({
  page,
}) => {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/admin/agents/capabilities", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/admin/agents/triggers?**", (route) =>
    route.fulfill({
      json: { schemaVersion: "np.agent-triggers-page.v1", items: [], nextCursor: null },
    }),
  );
  await page.route("**/api/admin/agents/configurations**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      if (writes.length === 1)
        await route.fulfill({ status: 502, body: "Temporary upstream failure" });
      else await route.fulfill({ json: { resourceId: id, replayed: false } });
    } else await route.fulfill({ json: agent });
  });
  await signInAsE2EAdmin(page);
  await page.goto("/admin/agents/configurations/new");
  const delegation = page.getByLabel(
    "Explicitly delegate my current staff authority to this Agent",
    { exact: true },
  );
  await expect(delegation).not.toBeChecked();
  await page.getByLabel("Agent name", { exact: true }).fill("Worker observer");
  await page.getByLabel("Registered check IDs", { exact: true }).fill("jobs.worker");
  await page.getByLabel("site:read", { exact: true }).check();
  await page.getByRole("combobox", { name: "site.inspect", exact: true }).click();
  await page.getByRole("option", { name: "Observe only", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator("form").getByRole("alert").filter({ hasText: "Request failed (502)" }),
  ).toHaveText("Request failed (502)");
  expect(writes).toHaveLength(1);
  expect(writes[0].body).not.toHaveProperty("authority");
  const savedDefinition = JSON.parse(writes[0].body.definitionJson as string) as Record<
    string,
    unknown
  >;
  expect(savedDefinition).toMatchObject({
    name: "Worker observer",
    template: "operator",
    scopes: ["site:read"],
    modelConnectionId: null,
    model: null,
    capabilityModes: [{ capabilityId: "site.inspect", mode: "observe" }],
    settings: [{ recipeId: "operator.worker-not-draining", checkIds: ["jobs.worker"] }],
  });
  expect(savedDefinition).not.toHaveProperty("enabled");
  expect(writes[0].body).not.toHaveProperty("triggers");
  await delegation.check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/agents/configurations/${id}$`));
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toMatchObject({ authority: { kind: "user", userId: principalId } });
  expect(writes[1].body.idempotencyKey).not.toBe(writes[0].body.idempotencyKey);
  expect(writes.every((write) => write.path === "/api/admin/agents/configurations")).toBe(true);
  await expect(
    page.getByText("draft · operator · version 1 (draft)", { exact: true }),
  ).toBeVisible();
});

test("Agent override policy creation binds the target and retries the exact typed draft safely", async ({
  page,
}) => {
  const policyId = "44444444-4444-4444-8444-444444444444";
  const bodies: string[] = [];
  const guidance =
    '<img data-runtime-untrusted="marker" src="invalid"> Keep review guidance separate from enforced rules.';
  await page.route("**/api/admin/agents/capabilities", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/admin/agents/triggers?**", (route) =>
    route.fulfill({
      json: { schemaVersion: "np.agent-triggers-page.v1", items: [], nextCursor: null },
    }),
  );
  await page.route(`**/api/admin/agents/configurations/${id}`, (route) =>
    route.fulfill({ json: agent }),
  );
  await page.route("**/api/admin/agents/policies**", async (route) => {
    if (route.request().method() === "POST") {
      bodies.push(route.request().postData() ?? "");
      if (bodies.length === 1)
        await route.fulfill({ status: 502, body: "Temporary upstream failure" });
      else await route.fulfill({ json: { resourceId: policyId, replayed: true } });
    } else {
      const submitted = JSON.parse(bodies.at(-1)!) as { definitionJson: string };
      await route.fulfill({
        json: {
          schemaVersion: "np.agent-policy-detail.v1",
          id: policyId,
          rowVersion: 1,
          version: 1,
          status: "draft",
          contentHash: digest,
          definition: JSON.parse(submitted.definitionJson) as unknown,
          availableActions: [
            "agents.policies.activate",
            "agents.policies.update",
            "agents.policies.validate",
          ],
          createdAt: at,
        },
      });
    }
  });
  await signInAsE2EAdmin(page);
  await page.goto(`/admin/agents/configurations/${id}`);
  await page.getByRole("link", { name: "Create Agent policy", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/agents/policies/new\\?agentId=${id}$`));
  await expect(page.getByText(`Applies to Agent ${id}.`, { exact: true })).toBeVisible();
  await page.getByLabel("Policy name", { exact: true }).fill("Worker review policy");
  await page.getByLabel("Guidance (Markdown text)", { exact: true }).fill(guidance);
  await page.getByRole("button", { name: "Save policy draft", exact: true }).click();
  await expect(
    page.locator("form").getByRole("alert").filter({ hasText: "Request failed (502)" }),
  ).toHaveText("Request failed (502)");
  expect(bodies).toHaveLength(1);
  await page.getByRole("button", { name: "Save policy draft", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/agents/policies/${policyId}$`));
  await expect(
    page.getByRole("heading", { name: "Worker review policy", exact: true }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  const command = JSON.parse(bodies[0]) as {
    definitionJson: string;
    definitionHash: string;
    idempotencyKey: string;
  };
  expect(JSON.parse(command.definitionJson)).toMatchObject({
    agentId: id,
    name: "Worker review policy",
    instructions: guidance,
    rules: catalog.defaultPolicyRules,
  });
  expect(command.definitionHash).toMatch(/^cj1:sha256:[A-Za-z0-9_-]{43}$/u);
  expect(command.idempotencyKey).toBeTruthy();
  await expect(page.getByText(guidance, { exact: true })).toBeVisible();
  await expect(page.locator('[data-runtime-untrusted="marker"]')).toHaveCount(0);
});

test("Policy simulation displays bounded non-authorizing facts and preserves unknown-outcome retry identity", async ({
  page,
}) => {
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.capabilityModes = [{ capabilityId: "site.inspect", mode: "observe" }];
  const fixture = await npBuildAgentPolicySimulationFixtureInputV1();
  const report = npSimulateAgentPolicyV1({
    policyId: id,
    policyVersion: 1,
    policyHash: digest,
    fixtureHash: fixture.fixtureHash,
    layers: [rules],
  });
  await page.route("**/api/admin/agents/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route(`**/api/admin/agents/policies/${id}`, (route) =>
    route.fulfill({
      json: {
        schemaVersion: "np.agent-policy-detail.v1",
        id,
        rowVersion: 1,
        version: 1,
        status: "draft",
        contentHash: digest,
        definition: {
          schemaVersion: "np.agent-policy-definition.v1",
          agentId: null,
          name: "Synthetic policy",
          instructions: "",
          rules,
        },
        availableActions: ["agents.policies.simulate", "agents.policies.validate"],
        createdAt: at,
      },
    }),
  );
  const writes: unknown[] = [];
  await page.route(`**/api/admin/agents/policies/${id}/simulate`, async (route) => {
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) await route.fulfill({ status: 502, body: "Temporary failure" });
    else await route.fulfill({ json: report });
  });
  await signInAsE2EAdmin(page);
  await page.goto(`/admin/agents/policies/${id}`);
  const section = page.getByRole("region", { name: "Policy simulation", exact: true });
  await section.getByRole("button", { name: "Simulate policy", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText("502");
  await section.getByRole("button", { name: "Simulate policy", exact: true }).click();
  await expect(section.getByRole("status")).toContainText("Simulation complete");
  await expect(section).toContainText("Non-authorizing");
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]).toMatchObject({ expectedVersion: 1, configHash: digest, ...fixture });
  await section.getByText("observe · 1 policy capabilities", { exact: true }).click();
  await expect(
    section.getByText("site.inspect: observe · read", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status", { name: "Non-authorizing simulation report" })).toHaveCount(
    0,
  );
});

test("Policy simulation discards stale and inaccessible evidence", async ({ page }) => {
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  const fixture = await npBuildAgentPolicySimulationFixtureInputV1();
  const report = npSimulateAgentPolicyV1({
    policyId: id,
    policyVersion: 1,
    policyHash: digest,
    fixtureHash: fixture.fixtureHash,
    layers: [rules],
  });
  await page.route("**/api/admin/agents/catalog", (route) => route.fulfill({ json: catalog }));
  await page.route(`**/api/admin/agents/policies/${id}`, (route) =>
    route.fulfill({
      json: {
        schemaVersion: "np.agent-policy-detail.v1",
        id,
        rowVersion: 1,
        version: 1,
        status: "draft",
        contentHash: digest,
        definition: {
          schemaVersion: "np.agent-policy-definition.v1",
          agentId: null,
          name: "Synthetic policy",
          instructions: "",
          rules,
        },
        availableActions: ["agents.policies.simulate", "agents.policies.validate"],
        createdAt: at,
      },
    }),
  );
  let reply: "mismatch" | "success" | "stale" | "denied" = "mismatch";
  await page.route(`**/api/admin/agents/policies/${id}/simulate`, async (route) => {
    if (reply === "mismatch") await route.fulfill({ json: { ...report, policyId: versionId } });
    else if (reply === "success") await route.fulfill({ json: report });
    else
      await route.fulfill({
        status: reply === "stale" ? 409 : 403,
        json: {
          error: {
            code: reply === "stale" ? "RUNTIME_VERSION_CONFLICT" : "SITE_ACCESS_DENIED",
            message: "Unavailable",
          },
        },
      });
  });
  await signInAsE2EAdmin(page);
  await page.goto(`/admin/agents/policies/${id}`);
  const section = page.getByRole("region", { name: "Policy simulation", exact: true });
  const button = section.getByRole("button", { name: "Simulate policy", exact: true });
  await button.click();
  await expect(section.getByRole("alert")).toContainText("does not match");
  await expect(section.getByRole("status")).toHaveCount(0);
  reply = "stale";
  await button.click();
  await expect(button).toBeDisabled();
  await expect(section.getByRole("alert")).toContainText("resource changed");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(button).toBeEnabled();
  reply = "success";
  await button.click();
  await expect(section.getByRole("status")).toContainText("Simulation complete");
  reply = "denied";
  await button.click();
  await expect(page.getByRole("heading", { name: "Synthetic policy", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Non-authorizing simulation report" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "no longer have access" }).first(),
  ).toBeVisible();
});

test("Structured manual runs preserve keyboard access, scalar input and retry identity through the result link", async ({
  page,
}, testInfo) => {
  const triggerId = "44444444-4444-4444-8444-444444444444";
  const runId = "55555555-5555-4555-8555-555555555555";
  const writes: Array<{ inputJson: string; idempotencyKey: string }> = [];
  await page.route("**/api/admin/agents/capabilities", (route) =>
    route.fulfill({
      json: {
        ...catalog,
        recipes: [
          {
            ...catalog.recipes[0],
            providerMode: "required",
            manualInputSchema: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              additionalProperties: false,
              properties: {
                topic: { type: "string", maxLength: 2000 },
                count: { type: "integer", minimum: 0, maximum: 3 },
                include: { type: "boolean" },
                note: { type: "string", maxLength: 2000 },
              },
              required: ["topic", "count", "include"],
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/admin/agents/triggers?**", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "np.agent-triggers-page.v1",
        items: [
          {
            schemaVersion: "np.agent-trigger-detail.v1",
            agentId: id,
            agentVersionId: versionId,
            definition: { type: "manual", id: triggerId },
            enabled: true,
            nextRunAt: null,
            createdAt: at,
            updatedAt: at,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route(`**/api/admin/agents/configurations/${id}`, (route) =>
    route.fulfill({
      json: {
        ...agent,
        status: "active",
        versionStatus: "active",
        draftVersionId: null,
        activeVersion: { id: versionId, configHash: digest },
        manualRecipeIds: ["operator.worker-not-draining"],
        availableActions: ["agents.configurations.run"],
      },
    }),
  );
  await page.route(`**/api/admin/agents/configurations/${id}/runs`, async (route) => {
    writes.push(route.request().postDataJSON() as { inputJson: string; idempotencyKey: string });
    if (writes.length < 3) await route.fulfill({ status: 502, body: "Temporary failure" });
    else await route.fulfill({ json: { resourceId: runId, replayed: false } });
  });
  await signInAsE2EAdmin(page);
  await page.goto(`/admin/agents/configurations/${id}`);
  await tabTo(page, page.getByRole("button", { name: "Run now", exact: true }));
  await page.keyboard.press("Enter");
  const topic = page.getByRole("textbox", { name: "topic (required)", exact: true });
  const count = page.getByRole("spinbutton", { name: "count (required)", exact: true });
  const include = page.getByRole("combobox", { name: "include (required)", exact: true });
  const goal = page.getByRole("textbox", { name: "Run goal", exact: true });
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  await expect(topic).toHaveValue("");
  // Native validation must focus the missing required scalar before any request.
  await tabTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect(count).toBeFocused();
  expect(writes).toHaveLength(0);
  await page.keyboard.type("0");
  await page.keyboard.press("Tab");
  await expect(include).toBeFocused();
  await page.keyboard.press("f");
  await page.keyboard.press("Tab");
  await expect(include).toHaveValue("1");
  await tabTo(page, goal);
  await page.keyboard.type("Inspect the requested evidence.");

  // Layout/media assertions are browser evidence, not human screen-reader or visual review.
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveClass(
        colorScheme === "dark" ? /dark/ : /^(?!.*\bdark\b)/,
      );
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      for (const control of [topic, count, include, goal, confirm]) {
        await expect(control).toBeVisible();
        await control.click({ trial: true });
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      }
      const screenshot = testInfo.outputPath(`manual-input-${viewport.width}-${colorScheme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
      await testInfo.attach(`manual-input-${viewport.width}-${colorScheme}`, {
        path: screenshot,
        contentType: "image/png",
      });
    }
  }
  await tabTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect(page.locator("form").getByRole("alert")).toContainText("502");
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0].inputJson)).toEqual({
    recipeId: "operator.worker-not-draining",
    goal: "Inspect the requested evidence.",
    input: { topic: "", count: 0, include: false },
  });
  await tabTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect.poll(() => writes.length).toBe(2);
  await expect(confirm).toBeEnabled();
  expect(writes[1]).toEqual(writes[0]);
  await tabTo(page, topic);
  await page.keyboard.type("  Edited evidence  ");
  await tabTo(page, confirm);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/admin/agents/activity/${runId}$`));
  expect(writes).toHaveLength(3);
  expect(writes[2].idempotencyKey).not.toBe(writes[0].idempotencyKey);
  expect(JSON.parse(writes[2].inputJson)).toMatchObject({
    input: { topic: "  Edited evidence  ", count: 0, include: false },
  });
});

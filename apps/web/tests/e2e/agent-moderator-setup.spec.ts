import { expect, test } from "@playwright/test";
import { npAgentModeratorRecipeSetupV1 } from "@nexpress/core/agent-contract";
import { agent, catalog, id } from "./fixtures/runtime-studio.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";

test("Moderator human approval setup creates only an explicit bounded draft", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    124 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  const setup = npAgentModeratorRecipeSetupV1;
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/admin/agents/capabilities", (route) =>
    route.fulfill({
      json: {
        ...catalog,
        recipes: [
          {
            id: setup.recipeId,
            version: 1,
            allowedTemplates: ["moderator"],
            providerMode: "required",
            triggerKinds: ["manual"],
            capabilityIds: setup.capabilityModes.map((entry) => entry.capabilityId),
          },
        ],
        connections: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            alias: "Moderator analysis",
            models: ["default-model", "moderator-model"],
          },
        ],
        scopes: setup.scopes,
        capabilities: setup.capabilityModes.map(({ capabilityId, mode }) => ({
          id: capabilityId,
          modes: [mode],
        })),
        effectiveBudget: { ...setup.budget, runsPerHour: 1 },
      },
    }),
  );
  await page.route("**/api/admin/agents/triggers?**", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "np.agent-triggers-page.v1",
        items: [],
        nextCursor: null,
      },
    }),
  );
  await page.route("**/api/admin/agents/configurations**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      await route.fulfill({ json: { resourceId: id, replayed: false } });
    } else await route.fulfill({ json: agent });
  });
  await signInAsE2EAdmin(page);
  await page.goto("/admin/agents/configurations/new");
  await page.getByLabel("Agent name", { exact: true }).fill("Community moderator");
  await page
    .getByRole("button", { name: "Use Moderator human approval setup", exact: true })
    .click();
  expect(writes).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Observation window (seconds)", { exact: true })).toHaveValue("600");
  await expect(page.getByLabel("Minimum independent accounts", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Minimum items", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("Automatic confidence (basis points)", { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("Collection slugs", { exact: true }).fill("posts");
  const provider = page.getByRole("combobox", { name: "Provider connection", exact: true });
  await expect(provider).not.toContainText("Moderator analysis");
  await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveCount(0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`moderator-setup-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await provider.click();
  await page.getByRole("option", { name: "Moderator analysis", exact: true }).click();
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: "moderator-model", exact: true }).click();
  await expect(
    page.getByLabel("Explicitly delegate my current staff authority to this Agent", {
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Runs per rolling hour", { exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/agents/configurations/${id}$`));
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toBe("/api/admin/agents/configurations");
  expect(writes[0].body).not.toHaveProperty("authority");
  expect(JSON.parse(writes[0].body.definitionJson as string)).toMatchObject({
    name: "Community moderator",
    template: "moderator",
    modelConnectionId: "55555555-5555-4555-8555-555555555555",
    model: "moderator-model",
    scopes: setup.scopes,
    autonomy: setup.autonomy,
    capabilityModes: setup.capabilityModes,
    budget: { runsPerHour: 1, directActionsPerHour: setup.budget.directActionsPerHour },
    settings: [{ ...setup.settings, collectionSlugs: ["posts"] }],
  });
});

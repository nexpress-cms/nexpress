import { expect, test } from "@playwright/test";
import { npAgentPublisherRecipeSetupV1 } from "@nexpress/core/agent-contract";
import { agent, catalog, id } from "./fixtures/runtime-studio.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";

test("Publisher content review setup creates only an explicit bounded draft", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    105 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  const setup = npAgentPublisherRecipeSetupV1;
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/admin/agents/capabilities", (route) =>
    route.fulfill({
      json: {
        ...catalog,
        recipes: [
          {
            id: setup.recipeId,
            version: 1,
            allowedTemplates: ["publisher"],
            providerMode: "required",
            triggerKinds: ["manual"],
            capabilityIds: setup.capabilityModes.map((entry) => entry.capabilityId),
          },
        ],
        connections: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            alias: "Publisher analysis",
            models: ["default-model", "publisher-model"],
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
    } else
      await route.fulfill({
        json: {
          ...agent,
          definition: {
            ...agent.definition,
            name: "Content reviewer",
            template: "publisher",
            scopes: setup.scopes,
            capabilityModes: setup.capabilityModes,
            autonomy: setup.autonomy,
            settings: [{ ...setup.settings, collectionSlugs: ["posts"] }],
          },
        },
      });
  });
  await signInAsE2EAdmin(page);
  await page.goto("/admin/agents/configurations/new");
  await page.getByLabel("Agent name", { exact: true }).fill("Content reviewer");
  await page
    .getByRole("button", { name: "Use Publisher content review setup", exact: true })
    .click();
  expect(writes).toHaveLength(0);
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  const collections = page.getByLabel("Collection slugs", { exact: true });
  await expect(collections).toHaveValue("");
  await expect(save).toBeDisabled();
  await collections.fill("posts");
  await expect(save).toBeEnabled();
  const provider = page.getByRole("combobox", { name: "Provider connection", exact: true });
  await expect(provider).not.toContainText("Publisher analysis");
  await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveCount(0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
  await provider.click();
  await page.getByRole("option", { name: "Publisher analysis", exact: true }).click();
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: "publisher-model", exact: true }).click();
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
    name: "Content reviewer",
    template: "publisher",
    modelConnectionId: "55555555-5555-4555-8555-555555555555",
    model: "publisher-model",
    scopes: setup.scopes,
    autonomy: setup.autonomy,
    capabilityModes: setup.capabilityModes,
    budget: { runsPerHour: 1, directActionsPerHour: 0 },
    settings: [{ ...setup.settings, collectionSlugs: ["posts"] }],
  });
});

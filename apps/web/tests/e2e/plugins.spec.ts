/**
 * Phase 23.6.3 - plugin admin/config golden path.
 *
 * The plugin surface has two contracts that are easy to regress in
 * isolation: the admin auto-form must save through the dedicated config
 * endpoint, and plugin route dispatch must observe the persisted config.
 * This spec exercises both through the built-in Reading Time plugin.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

const PLUGIN_ID = "reading-time";
const DEFAULT_CONFIG = { wordsPerMinute: 220 };

interface PluginDetail {
  enabled: boolean;
  config?: {
    wordsPerMinute?: number;
  };
}

interface PluginListResponse {
  items: Array<{
    id: string;
    configFields?: Array<{ name: string; type: string }> | null;
  }>;
}

async function csrfHeaders(context: BrowserContext): Promise<Record<string, string>> {
  const token = (await context.cookies()).find((cookie) => cookie.name === "np-csrf")?.value;
  if (!token) {
    throw new Error("Missing np-csrf cookie after e2e admin login");
  }
  return { "x-csrf-token": token };
}

async function getReadingTimeDetail(page: Page): Promise<PluginDetail> {
  const response = await page.request.get(`/api/plugins/${PLUGIN_ID}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as PluginDetail;
}

async function setReadingTimeEnabled(
  page: Page,
  context: BrowserContext,
  enabled: boolean,
): Promise<void> {
  const response = await page.request.patch(`/api/plugins/${PLUGIN_ID}`, {
    data: { enabled },
    headers: await csrfHeaders(context),
  });
  expect(response.status()).toBe(200);
}

async function setReadingTimeConfig(
  page: Page,
  context: BrowserContext,
  value: typeof DEFAULT_CONFIG,
): Promise<void> {
  const response = await page.request.put(`/api/admin/plugins/${PLUGIN_ID}/config`, {
    data: { value },
    headers: await csrfHeaders(context),
  });
  expect(response.status()).toBe(200);
}

function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");
}

test.describe("plugin admin and config", () => {
  test.describe.configure({ mode: "serial" });

  let restoreEnabled: boolean | null = null;
  let restoreConfig: typeof DEFAULT_CONFIG | null = null;

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await signInAsE2EAdmin(page);

    const detail = await getReadingTimeDetail(page);
    restoreEnabled = detail.enabled;
    restoreConfig = {
      wordsPerMinute: detail.config?.wordsPerMinute ?? DEFAULT_CONFIG.wordsPerMinute,
    };

    if (!detail.enabled) {
      await setReadingTimeEnabled(page, context, true);
    }
    await setReadingTimeConfig(page, context, DEFAULT_CONFIG);
  });

  test.afterEach(async ({ page, context }) => {
    if (restoreConfig !== null) {
      await setReadingTimeConfig(page, context, restoreConfig);
      restoreConfig = null;
    }
    if (restoreEnabled !== null) {
      await setReadingTimeEnabled(page, context, restoreEnabled);
      restoreEnabled = null;
    }
  });

  test("lists installed plugins and renders the config-backed detail page", async ({ page }) => {
    const listResponse = await page.request.get("/api/plugins");
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as PluginListResponse;
    const readingTime = list.items.find((plugin) => plugin.id === PLUGIN_ID);
    expect(readingTime?.configFields).toContainEqual(
      expect.objectContaining({ name: "wordsPerMinute", type: "number" }),
    );

    await page.goto("/admin/plugins");
    await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
    await expect(page.getByText("Reading Time", { exact: true })).toBeVisible();

    await page.goto(`/admin/plugins/${PLUGIN_ID}`);
    await expect(page.getByRole("heading", { name: "Reading Time" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByLabel("Words per minute")).toHaveValue("220");
  });

  test("renders the configSchema auto-form in the plugin list Configure dialog", async ({
    page,
  }) => {
    await page.goto("/admin/plugins");

    await page.getByLabel("Configure Reading Time").click();
    const dialog = page.getByRole("dialog", { name: "Reading Time config" });
    await expect(dialog).toBeVisible();

    const wordsPerMinute = dialog.getByLabel("Words per minute");
    await expect(wordsPerMinute).toHaveValue("220");
    await wordsPerMinute.fill("180");

    const savePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/admin/plugins/${PLUGIN_ID}/config`) &&
        response.request().method() === "PUT",
    );
    await dialog.getByRole("button", { name: "Save config" }).click();
    const saveResponse = await savePromise;
    expect(saveResponse.status()).toBe(200);
    await expect(dialog).toBeHidden();

    const detail = await getReadingTimeDetail(page);
    expect(detail.config?.wordsPerMinute).toBe(180);
  });

  test("saves config through the dedicated route and applies it during plugin dispatch", async ({
    page,
    context,
  }) => {
    await page.goto(`/admin/plugins/${PLUGIN_ID}`);

    const wordsPerMinute = page.getByLabel("Words per minute");
    await expect(wordsPerMinute).toHaveValue("220");
    await wordsPerMinute.fill("100");

    const savePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/admin/plugins/${PLUGIN_ID}/config`) &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save settings" }).click();
    const saveResponse = await savePromise;
    expect(saveResponse.status()).toBe(200);
    await expect(page.getByText("Config saved.")).toBeVisible();

    const detail = await getReadingTimeDetail(page);
    expect(detail.config?.wordsPerMinute).toBe(100);

    const estimateResponse = await page.request.get(
      `/api/plugins/${PLUGIN_ID}/estimate?text=${encodeURIComponent(words(250))}`,
    );
    expect(estimateResponse.status()).toBe(200);
    expect(await estimateResponse.json()).toEqual({
      minutes: 3,
      wordsPerMinute: 100,
      wordCount: 250,
    });

    const legacyPatch = await page.request.patch(`/api/plugins/${PLUGIN_ID}`, {
      data: { config: { wordsPerMinute: 180 } },
      headers: await csrfHeaders(context),
    });
    expect(legacyPatch.status()).toBe(400);
    expect(await legacyPatch.text()).toContain("PUT /api/admin/plugins/<id>/config");
  });
});

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { parseXliff, renderXliff } from "@nexpress/xliff";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

test.describe("Admin translation interchange", () => {
  test("exports, previews, and applies an XLIFF catalog from Settings", async ({
    page,
    context,
  }) => {
    const title = `Translation exchange ${Date.now()}`;
    const targetTitle = `번역 교환 ${Date.now()}`;
    await context.clearCookies();
    // This flow hits several Admin endpoints and may run late in the full E2E
    // suite. Keep its proxy bucket isolated from unrelated specs that share the
    // same worker IP.
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.118" });
    await signInAsE2EAdmin(page);
    const headers = await csrfHeaders(context);

    const created = await page.request.post("/api/collections/pages", {
      data: {
        title,
        seoDescription: "Translation interchange E2E source",
        locale: "en",
        _status: "published",
      },
      headers,
    });
    expect(created.status()).toBe(201);
    const source = (await created.json()) as { id: string };
    let targetId: string | null = null;

    try {
      const params = new URLSearchParams({
        format: "xliff",
        collection: "pages",
        sourceLocale: "en",
        targetLocale: "ko",
      });
      const exported = await page.request.get(`/api/admin/i18n/interchange?${params.toString()}`);
      expect(exported.status()).toBe(200);
      const catalog = parseXliff(await exported.text());
      const titleUnit = catalog.files
        .flatMap((file) => file.units)
        .find((unit) => unit.id === "title" && unit.source === title);
      expect(titleUnit).toBeDefined();
      if (!titleUnit) throw new Error("Expected exported title translation unit");
      titleUnit.target = targetTitle;

      await page.goto("/admin/settings");
      await page.getByRole("tab", { name: /^Translations$/ }).click();
      await expect(page.getByRole("heading", { name: /^Export catalog$/ })).toBeVisible();
      await page.getByLabel("Translation file").setInputFiles({
        name: "pages-en-ko.xliff",
        mimeType: "application/xliff+xml",
        buffer: Buffer.from(renderXliff(catalog)),
      });

      const previewPromise = nextInterchangePost(page);
      await page.getByRole("button", { name: /^Preview import$/ }).click();
      const preview = await previewPromise;
      expect(preview.status()).toBe(200);
      await expect(page.getByRole("heading", { name: /^Import preview$/ })).toBeVisible();
      await expect(page.getByText("create", { exact: true }).first()).toBeVisible();

      await page.getByRole("button", { name: /^Apply translations$/ }).click();
      const dialog = page.getByRole("dialog", { name: /^Apply this translation catalog\?$/ });
      await expect(dialog).toBeVisible();
      const applyPromise = nextInterchangePost(page);
      await dialog.getByRole("button", { name: /^Confirm and apply$/ }).click();
      const applied = await applyPromise;
      expect(applied.status()).toBe(200);
      const payload = (await applied.json()) as {
        result: { applied: Array<{ docId: string; operation: string }> };
      };
      const target = payload.result.applied.find((entry) => entry.operation === "create");
      expect(target).toBeDefined();
      if (!target) throw new Error("Expected translation create result");
      targetId = target.docId;
      await expect(page.getByRole("heading", { name: /^Import applied$/ })).toBeVisible();

      const targetResponse = await page.request.get(`/api/collections/pages/${targetId}`);
      expect(targetResponse.status()).toBe(200);
      await expect(targetResponse.json()).resolves.toMatchObject({
        title: targetTitle,
        locale: "ko",
      });
    } finally {
      if (targetId) {
        await page.request.delete(`/api/collections/pages/${targetId}`, { headers });
      }
      await page.request.delete(`/api/collections/pages/${source.id}`, { headers });
    }
  });
});

async function csrfHeaders(context: BrowserContext): Promise<Record<string, string>> {
  const token = (await context.cookies()).find((cookie) => cookie.name === "np-csrf")?.value;
  if (!token) throw new Error("Missing np-csrf cookie after E2E admin login.");
  return { "X-CSRF-Token": token };
}

function nextInterchangePost(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/i18n/interchange") &&
      response.request().method() === "POST",
  );
}

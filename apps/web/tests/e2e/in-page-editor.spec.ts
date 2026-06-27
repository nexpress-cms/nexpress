import { expect, test } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

interface CreatedBlock {
  type?: string;
  props?: Record<string, unknown>;
}

interface CreatedPage {
  id?: number | string;
  blocks?: CreatedBlock[];
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

test.describe("in-page block editor", () => {
  test("Document view edits preview blocks and persists them", async ({ page, context }) => {
    const title = `E2E document editor ${Date.now()}`;
    const slug = slugify(title);
    const heroTitle = "Document mode hero";

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    await page.goto("/admin/collections/pages/create");
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);

    const documentTab = page.getByRole("tab", { name: "Document view" });
    await expect(documentTab).toBeVisible();
    await documentTab.click();
    await expect(documentTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Draft canvas is empty.")).toBeVisible({ timeout: 15_000 });

    const quickInsert = page.getByPlaceholder("Write something, or type / to insert a block");
    await expect(quickInsert).toBeVisible();
    await quickInsert.fill("Hello document mode");
    await quickInsert.press("Enter");

    await expect(page.getByText("3 words")).toBeVisible();
    await expect(page.getByText("1 blocks")).toBeVisible();

    await quickInsert.fill("/hero");
    await expect(quickInsert).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("listbox")).toBeVisible();
    await quickInsert.press("Enter");

    await expect(page.getByText("2 blocks")).toBeVisible();

    const preview = page.frameLocator('iframe[title="Document preview"]');
    await expect(preview.getByText("Build pages block by block")).toBeVisible({
      timeout: 10_000,
    });

    await preview.getByText("Build pages block by block").hover();
    await page.getByRole("button", { name: "Settings for Hero" }).click();

    const dialog = page.getByRole("dialog", { name: /Hero/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: /^Title/ }).fill(heroTitle);
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(preview.getByText(heroTitle)).toBeVisible({ timeout: 10_000 });

    const publishButton = page
      .locator('button[type="submit"]:visible')
      .filter({ hasText: /^Publish$/ });
    await page.getByLabel("title", { exact: true }).fill(title);

    const publishResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/collections/pages") && response.request().method() === "POST",
    );
    await publishButton.click();
    const apiRes = await publishResponse;
    expect(apiRes.status()).toBe(201);

    const created = (await apiRes.json()) as CreatedPage;
    if (created.id === undefined || created.id === null) {
      throw new Error("Created page response did not include an id.");
    }
    if (!Array.isArray(created.blocks)) {
      throw new Error("Created page response did not include persisted blocks.");
    }

    const createdHero = created.blocks.find((block) => block.type === "hero");
    expect(createdHero?.props?.title).toBe(heroTitle);

    const publicResponse = await page.goto(`/${slug}`);
    expect(publicResponse?.status()).toBe(200);
    await expect(page.getByText(heroTitle)).toBeVisible({ timeout: 10_000 });

    await page.goto(`/admin/collections/pages/${created.id}`);
    const reopenedDocumentTab = page.getByRole("tab", { name: "Document view" });
    await expect(reopenedDocumentTab).toBeVisible();
    await reopenedDocumentTab.click();

    const reopenedPreview = page.frameLocator('iframe[title="Document preview"]');
    await expect(reopenedPreview.getByText(heroTitle)).toBeVisible({ timeout: 10_000 });
  });
});

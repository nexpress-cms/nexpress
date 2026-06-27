import { expect, test, type Page } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

function visibleSaveDraftButton(page: Page) {
  return page.locator('button:visible').filter({ hasText: /^Save as Draft$/ }).first();
}

test.describe("admin authoring reliability", () => {
  test("guards internal navigation when collection form edits are unsaved", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await signInAsE2EAdmin(page);

    await page.goto("/admin/collections/pages/create");
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);
    await expect(visibleSaveDraftButton(page)).toBeEnabled();

    await page.getByLabel("title", { exact: true }).fill(`Unsaved guard ${Date.now()}`);
    await expect(page.locator("[data-np-authoring-status]")).toContainText("Unsaved changes");

    const dashboardLink = page.getByRole("link", { name: /^Dashboard$/ }).first();
    page.once("dialog", async (dialog) => {
      expect(dialog.message().toLowerCase()).toContain("unsaved changes");
      await dialog.dismiss();
    });
    await dashboardLink.click();
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);

    page.once("dialog", async (dialog) => {
      expect(dialog.message().toLowerCase()).toContain("unsaved changes");
      await dialog.accept();
    });
    await dashboardLink.click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("surfaces failed manual saves without clearing dirty editor state", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await signInAsE2EAdmin(page);

    await page.route("**/api/collections/pages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Forced save failure" } }),
      });
    });

    await page.goto("/admin/collections/pages/create");
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);
    await expect(visibleSaveDraftButton(page)).toBeEnabled();
    await expect(page.getByText(/0\s+blocks total/)).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("title", { exact: true }).fill(`Save failure ${Date.now()}`);
    await visibleSaveDraftButton(page).click();

    await expect(page.getByText("Forced save failure")).toBeVisible();
    await expect(page.locator("[data-np-authoring-status]")).toContainText("Unsaved changes");
    await expect(page.getByText("Save failed")).toBeVisible();
  });

  test("shows revision detail differences against the current form", async ({ page, context }) => {
    const title = `Revision compare ${Date.now()}`;
    const revisedTitle = `${title} revised`;

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    await page.goto("/admin/collections/pages/create");
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);
    await expect(visibleSaveDraftButton(page)).toBeEnabled();

    await page.getByLabel("title", { exact: true }).fill(title);
    await page.getByLabel("seoDescription", { exact: true }).fill("revision compare seed");

    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/collections/pages") && response.request().method() === "POST",
    );
    await visibleSaveDraftButton(page).click();
    const createdResponse = await createResponse;
    expect(createdResponse.status()).toBe(201);
    const created = (await createdResponse.json()) as { id?: unknown };
    expect(typeof created.id).toBe("string");

    await page.goto(`/admin/collections/pages/${String(created.id)}`);
    await expect(visibleSaveDraftButton(page)).toBeEnabled();
    await page.getByLabel("title", { exact: true }).fill(revisedTitle);

    const patchResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/collections/pages/${String(created.id)}`) &&
        response.request().method() === "PATCH",
    );
    await visibleSaveDraftButton(page).click();
    expect((await patchResponse).status()).toBe(200);

    const revisionsPanel = page.locator("[data-np-revisions-panel]");
    await revisionsPanel.scrollIntoViewIfNeeded();
    await expect(revisionsPanel).toBeVisible();
    await expect(revisionsPanel.getByRole("button", { name: /v1/ })).toBeVisible({
      timeout: 10_000,
    });

    await revisionsPanel.getByRole("button", { name: /v1/ }).click();
    const dialog = page.getByRole("dialog", { name: /Version 1/ });
    await expect(dialog).toBeVisible();
    const diff = dialog.locator("[data-np-revision-diff]");
    await expect(diff).toContainText("Compared with current form");
    await expect(diff).toContainText("title");
  });
});

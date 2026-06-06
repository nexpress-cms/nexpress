import { expect, test } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

test.describe("in-page block editor", () => {
  test("Document view inserts rich text and updates the footer metrics", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await signInAsE2EAdmin(page);

    await page.goto("/admin/collections/pages/create");
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);

    await page.getByRole("tab", { name: "Document view" }).click();

    const quickInsert = page.getByPlaceholder("Write something, or type / to insert a block");
    await expect(quickInsert).toBeVisible();
    await quickInsert.fill("Hello document mode");
    await quickInsert.press("Enter");

    await expect(page.getByText("3 words")).toBeVisible();
    await expect(page.getByText("1 blocks")).toBeVisible();
  });
});

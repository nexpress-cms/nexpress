import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

function visibleSaveDraftButton(page: Page) {
  return page
    .locator("button:visible")
    .filter({ hasText: /^Save as Draft$/ })
    .first();
}

async function csrfHeaders(context: BrowserContext): Promise<Record<string, string>> {
  const cookies = await context.cookies();
  const token = cookies.find((cookie) => cookie.name === "np-csrf")?.value;
  if (!token) {
    throw new Error("Missing np-csrf cookie after E2E admin login.");
  }
  return { "X-CSRF-Token": token };
}

const richTextFixture = (text: string): Record<string, unknown> => ({
  root: {
    type: "root",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children: [
      {
        type: "paragraph",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: [{ type: "text", version: 1, text }],
      },
    ],
  },
});

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

  test("offers autosave recovery and applies it as unsaved form state", async ({
    page,
    context,
  }) => {
    const title = `Autosave recovery ${Date.now()}`;
    const recoveredTitle = `${title} recovered`;

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    const headers = await csrfHeaders(context);
    const createResponse = await page.request.post("/api/collections/posts", {
      data: {
        kind: "article",
        title,
        content: richTextFixture("Original body"),
        _status: "draft",
      },
      headers,
    });
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { id?: unknown };
    expect(typeof created.id).toBe("string");

    const autosaveResponse = await page.request.post(
      `/api/collections/posts/${String(created.id)}/autosave`,
      {
        data: {
          kind: "article",
          title: recoveredTitle,
          content: richTextFixture("Recovered body"),
          excerpt: "Recovered excerpt",
        },
        headers,
      },
    );
    expect(autosaveResponse.ok()).toBeTruthy();

    await page.goto(`/admin/collections/posts/${String(created.id)}`);
    await expect(page).toHaveURL(new RegExp(`/admin/collections/posts/${String(created.id)}$`));

    const recovery = page.locator("[data-np-autosave-recovery]");
    await expect(recovery).toContainText("Autosave recovery available", { timeout: 15_000 });
    await expect(recovery).toContainText("title");

    await recovery.getByRole("button", { name: "Review" }).click();
    const dialog = page.getByRole("dialog", { name: "Autosave recovery" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-np-autosave-recovery-diff]")).toContainText("title");
    await expect(dialog.locator("[data-np-autosave-recovery-summary]")).toContainText(
      recoveredTitle,
    );

    await dialog.getByRole("button", { name: "Recover autosave" }).click();
    await expect(page.getByLabel("title", { exact: true })).toHaveValue(recoveredTitle);
    await expect(page.locator("[data-np-authoring-status]")).toContainText("Unsaved changes");
    await expect(page.locator("[data-np-autosave-recovery]")).toHaveCount(0);
  });
});

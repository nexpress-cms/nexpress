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

async function createDraftPost(
  page: Page,
  context: BrowserContext,
  title: string,
): Promise<{ id: string; headers: Record<string, string> }> {
  const headers = await csrfHeaders(context);
  const response = await page.request.post("/api/collections/posts", {
    data: {
      kind: "article",
      title,
      content: richTextFixture("Original body"),
      _status: "draft",
    },
    headers,
  });
  expect(response.status()).toBe(201);
  const created = (await response.json()) as { id?: unknown };
  expect(typeof created.id).toBe("string");
  return { id: created.id, headers };
}

async function writePostAutosave(
  page: Page,
  postId: string,
  headers: Record<string, string>,
  input: { title: string; excerpt?: string; body?: string },
): Promise<void> {
  const response = await page.request.post(`/api/collections/posts/${postId}/autosave`, {
    data: {
      kind: "article",
      title: input.title,
      content: richTextFixture(input.body ?? "Recovered body"),
      ...(input.excerpt ? { excerpt: input.excerpt } : {}),
    },
    headers,
  });
  expect(response.ok()).toBeTruthy();
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

  test("guards browser history back when collection form edits are unsaved", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await signInAsE2EAdmin(page);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/collections/pages/create");
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);
    await expect(visibleSaveDraftButton(page)).toBeEnabled();

    await page.getByLabel("title", { exact: true }).fill(`History guard ${Date.now()}`);
    await expect(page.locator("[data-np-authoring-status]")).toContainText("Unsaved changes");

    page.once("dialog", async (dialog) => {
      expect(dialog.message().toLowerCase()).toContain("unsaved changes");
      await dialog.dismiss();
    });
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);

    page.once("dialog", async (dialog) => {
      expect(dialog.message().toLowerCase()).toContain("unsaved changes");
      await dialog.accept();
    });
    await page.evaluate(() => window.history.back());
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
    await expect(page.getByRole("main").getByText(/0\s+blocks total/)).toBeVisible({
      timeout: 15_000,
    });

    await page.getByLabel("title", { exact: true }).fill(`Save failure ${Date.now()}`);
    await visibleSaveDraftButton(page).click();

    await expect(page.getByText("Forced save failure")).toBeVisible();
    await expect(page.locator("[data-np-authoring-status]")).toContainText("Unsaved changes");
    await expect(page.getByText("Save failed")).toBeVisible({ timeout: 10_000 });
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
    const recoveredBody = `Recovered body ${Date.now()}`;
    const continuedBody = " — continued after recovery";

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    const { id, headers } = await createDraftPost(page, context, title);
    await writePostAutosave(page, id, headers, {
      title: recoveredTitle,
      excerpt: "Recovered excerpt",
      body: recoveredBody,
    });

    await page.goto(`/admin/collections/posts/${id}`);
    await expect(page).toHaveURL(new RegExp(`/admin/collections/posts/${id}$`));
    const contentEditor = page.locator(".np-editor-content").first();
    await expect(contentEditor).toContainText("Original body", { timeout: 15_000 });

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

    const autosaveAfterRecover = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/collections/posts/${id}/autosave`) &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Recover autosave" }).click();
    await expect(page.getByLabel("title", { exact: true })).toHaveValue(recoveredTitle);
    await expect(contentEditor).toContainText(recoveredBody);
    await contentEditor.click();
    await contentEditor.press("End");
    await contentEditor.type(continuedBody);
    await expect(contentEditor).toContainText(`${recoveredBody}${continuedBody}`);
    await expect(page.locator("[data-np-authoring-status]")).toContainText("Unsaved changes");
    await expect(page.locator("[data-np-autosave-recovery]")).toHaveCount(0);
    const autosaveResponse = await autosaveAfterRecover;
    expect(autosaveResponse.ok()).toBeTruthy();
    const autosavePayload = autosaveResponse.request().postDataJSON() as {
      content?: unknown;
    };
    const serializedContent = JSON.stringify(autosavePayload.content);
    expect(serializedContent).toContain(recoveredBody);
    expect(serializedContent).toContain(continuedBody.trim());
    expect(serializedContent).not.toContain("Original body");
    await expect(page.getByText(/Autosaved/)).toBeVisible({ timeout: 10_000 });
  });

  test("replaces the visible rich-text body after restoring a revision", async ({
    page,
    context,
  }) => {
    const title = `Rich-text revision restore ${Date.now()}`;
    const updatedBody = `Updated body ${Date.now()}`;

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    const { id, headers } = await createDraftPost(page, context, title);
    const updateResponse = await page.request.patch(`/api/collections/posts/${id}`, {
      data: {
        kind: "article",
        title,
        content: richTextFixture(updatedBody),
        _status: "draft",
      },
      headers,
    });
    expect(updateResponse.status()).toBe(200);

    await page.goto(`/admin/collections/posts/${id}`);
    await expect(page).toHaveURL(new RegExp(`/admin/collections/posts/${id}$`));

    const contentEditor = page.locator(".np-editor-content").first();
    await expect(contentEditor).toContainText(updatedBody, { timeout: 15_000 });

    const revisionsPanel = page.locator("[data-np-revisions-panel]");
    await revisionsPanel.scrollIntoViewIfNeeded();
    const versionOne = revisionsPanel.getByRole("button", { name: /v1/ });
    await expect(versionOne).toBeVisible({ timeout: 10_000 });
    await versionOne.click();

    const revisionDialog = page.getByRole("dialog", { name: /Version 1/ });
    await expect(revisionDialog).toBeVisible();
    page.once("dialog", async (confirmation) => {
      await confirmation.accept();
    });
    const restoreResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/collections/posts/${id}/revisions/`) &&
        response.url().endsWith("/restore") &&
        response.request().method() === "POST",
    );
    await revisionDialog.getByRole("button", { name: "Restore this version" }).click();
    expect((await restoreResponse).ok()).toBeTruthy();

    await expect(contentEditor).toContainText("Original body", { timeout: 15_000 });
    await expect(contentEditor).not.toContainText(updatedBody);
  });

  test("persists autosave recovery dismissal until a newer autosave exists", async ({
    page,
    context,
  }) => {
    const title = `Autosave dismiss ${Date.now()}`;
    const dismissedTitle = `${title} dismissed`;
    const newerTitle = `${title} newer`;

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    const { id, headers } = await createDraftPost(page, context, title);
    await writePostAutosave(page, id, headers, {
      title: dismissedTitle,
      excerpt: "Dismissed autosave",
    });

    await page.goto(`/admin/collections/posts/${id}`);
    const recovery = page.locator("[data-np-autosave-recovery]");
    await expect(recovery).toContainText("Autosave recovery available", { timeout: 15_000 });
    await recovery.getByRole("button", { name: "Dismiss" }).click();
    await expect(recovery).toHaveCount(0);

    await page.reload();
    await expect(page.locator("[data-np-autosave-recovery]")).toHaveCount(0);

    await writePostAutosave(page, id, headers, {
      title: newerTitle,
      excerpt: "Newer autosave",
    });
    await page.reload();
    const newRecovery = page.locator("[data-np-autosave-recovery]");
    await expect(newRecovery).toContainText("Autosave recovery available", { timeout: 15_000 });
    await newRecovery.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("dialog", { name: "Autosave recovery" })).toContainText(newerTitle);
  });
});

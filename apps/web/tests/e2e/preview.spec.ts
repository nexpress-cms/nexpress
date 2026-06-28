import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

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

async function createDraftPage(
  page: Page,
  context: BrowserContext,
  title: string,
): Promise<{ id: string }> {
  const response = await page.request.post("/api/collections/pages", {
    data: {
      title,
      _status: "draft",
    },
    headers: await csrfHeaders(context),
  });
  expect(response.status()).toBe(201);
  const created = (await response.json()) as { id?: unknown };
  expect(typeof created.id).toBe("string");
  return { id: created.id };
}

async function createDraftPost(
  page: Page,
  context: BrowserContext,
  title: string,
  body: string,
): Promise<{ id: string }> {
  const response = await page.request.post("/api/collections/posts", {
    data: {
      kind: "article",
      title,
      content: richTextFixture(body),
      _status: "draft",
    },
    headers: await csrfHeaders(context),
  });
  expect(response.status()).toBe(201);
  const created = (await response.json()) as { id?: unknown };
  expect(typeof created.id).toBe("string");
  return { id: created.id };
}

async function fetchPreviewResolution(
  page: Page,
  collection: string,
  id: string,
): Promise<{ path: string; href: string }> {
  const response = await page.request.get(`/api/admin/collections/${collection}/${id}/preview`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as { path?: unknown; href?: unknown };
  expect(typeof payload.path).toBe("string");
  expect(typeof payload.href).toBe("string");
  return { path: payload.path, href: payload.href };
}

async function expectPreviewPath(page: Page, expectedPath: string): Promise<string> {
  const link = page.getByRole("link", { name: /^Preview$/ });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();

  const url = new URL(href ?? "", page.url());
  expect(url.pathname).toBe("/api/preview");
  expect(url.searchParams.get("path")).toBe(expectedPath);
  return `${url.pathname}${url.search}`;
}

test.describe("admin preview links", () => {
  test("previews draft pages at their public catch-all URL", async ({ page, context }) => {
    const title = `Preview draft page ${Date.now()}`;

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    const created = await createDraftPage(page, context, title);
    const { path: publicPath } = await fetchPreviewResolution(page, "pages", created.id);

    const publicResponse = await page.goto(publicPath);
    expect(publicResponse?.status()).toBe(404);

    await page.goto(`/admin/collections/pages/${created.id}`);
    const previewHref = await expectPreviewPath(page, publicPath);

    const previewResponse = await page.goto(previewHref);
    expect(previewResponse?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(publicPath);
    await expect(page.getByText("Draft preview")).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("previews draft posts at their blog detail URL", async ({ page, context }) => {
    const title = `Preview draft post ${Date.now()}`;
    const body = `Preview draft post body ${Date.now()}`;

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    const created = await createDraftPost(page, context, title, body);
    const { path: publicPath } = await fetchPreviewResolution(page, "posts", created.id);

    const publicResponse = await page.goto(publicPath);
    expect(publicResponse?.status()).toBe(404);

    await page.goto(`/admin/collections/posts/${created.id}`);
    const previewHref = await expectPreviewPath(page, publicPath);

    const previewResponse = await page.goto(previewHref);
    expect(previewResponse?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(publicPath);
    await expect(page.getByText("Draft preview")).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("saves a new draft page and opens its preview from the create screen", async ({
    page,
    context,
  }) => {
    const title = `Create preview page ${Date.now()}`;

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    await page.goto("/admin/collections/pages/create");
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);
    await page.getByLabel("title", { exact: true }).fill(title);

    const popupPromise = context.waitForEvent("page");
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/collections/pages") && response.request().method() === "POST",
    );
    const previewResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/collections/pages/") &&
        response.url().endsWith("/preview") &&
        response.request().method() === "GET",
    );

    await page.getByRole("button", { name: /^Save Draft & Preview$/ }).click();

    const [previewPage, createResponse, previewResponse] = await Promise.all([
      popupPromise,
      createResponsePromise,
      previewResponsePromise,
    ]);
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { id?: unknown; title?: unknown };
    expect(typeof created.id).toBe("string");
    expect(created.title).toBe(title);

    expect(previewResponse.status()).toBe(200);
    const preview = (await previewResponse.json()) as { path?: unknown; href?: unknown };
    expect(typeof preview.path).toBe("string");
    expect(typeof preview.href).toBe("string");

    await previewPage.waitForURL((url) => url.pathname === preview.path, { timeout: 15_000 });
    await expect(previewPage.getByText("Draft preview")).toBeVisible();
    await previewPage.close();

    await expect(page).toHaveURL(new RegExp(`/admin/collections/pages/${created.id}$`), {
      timeout: 15_000,
    });
  });

  test("saves dirty edits before opening preview", async ({ page, context }) => {
    const title = `Dirty preview page ${Date.now()}`;
    const updatedTitle = `${title} updated`;

    await context.clearCookies();
    await signInAsE2EAdmin(page);

    const created = await createDraftPage(page, context, title);
    const { path: publicPath } = await fetchPreviewResolution(page, "pages", created.id);

    await page.goto(`/admin/collections/pages/${created.id}`);
    await expect(page).toHaveURL(new RegExp(`/admin/collections/pages/${created.id}$`));
    await expectPreviewPath(page, publicPath);

    await page.getByLabel("title", { exact: true }).fill(updatedTitle);
    const savePreviewButton = page.getByRole("button", { name: /^Save & Preview$/ });
    await expect(savePreviewButton).toBeVisible();

    const popupPromise = context.waitForEvent("page");
    const patchResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/collections/pages/${created.id}`) &&
        response.request().method() === "PATCH",
    );
    const previewResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/admin/collections/pages/${created.id}/preview`) &&
        response.request().method() === "GET",
    );

    await savePreviewButton.click();

    const [previewPage, patchResponse, previewResponse] = await Promise.all([
      popupPromise,
      patchResponsePromise,
      previewResponsePromise,
    ]);
    expect(patchResponse.ok()).toBeTruthy();
    const patched = (await patchResponse.json()) as { title?: unknown };
    expect(patched.title).toBe(updatedTitle);
    expect(previewResponse.ok()).toBeTruthy();

    const preview = (await previewResponse.json()) as { path?: unknown };
    expect(preview.path).toBe(publicPath);

    await previewPage.waitForURL((url) => url.pathname === publicPath, { timeout: 15_000 });
    await expect(previewPage.getByText("Draft preview")).toBeVisible();
    await previewPage.close();
  });
});

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
): Promise<{ id: string; path: string }> {
  const response = await page.request.post("/api/collections/pages", {
    data: {
      title,
      _status: "draft",
    },
    headers: await csrfHeaders(context),
  });
  expect(response.status()).toBe(201);
  const created = (await response.json()) as { id?: unknown; locale?: unknown; slug?: unknown };
  expect(typeof created.id).toBe("string");
  expect(typeof created.slug).toBe("string");
  const locale = typeof created.locale === "string" ? created.locale : null;
  const path = locale ? `/${locale}/${created.slug}` : `/${created.slug}`;
  return { id: created.id, path };
}

async function createDraftPost(
  page: Page,
  context: BrowserContext,
  title: string,
  body: string,
): Promise<{ id: string; slug: string }> {
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
  const created = (await response.json()) as { id?: unknown; slug?: unknown };
  expect(typeof created.id).toBe("string");
  expect(typeof created.slug).toBe("string");
  return { id: created.id, slug: created.slug };
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
    const publicPath = created.path;

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
    const publicPath = `/blog/${created.slug}`;

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
});

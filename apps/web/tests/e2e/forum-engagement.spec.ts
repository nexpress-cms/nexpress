import { expect, test, type BrowserContext } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

async function csrfHeaders(context: BrowserContext): Promise<Record<string, string>> {
  const token = (await context.cookies()).find((cookie) => cookie.name === "np-csrf")?.value;
  if (!token) throw new Error("Missing np-csrf cookie after E2E admin login.");
  return { "X-CSRF-Token": token };
}

const richTextBody = {
  version: 1,
  document: {
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
          children: [{ type: "text", version: 1, text: "Engagement smoke body" }],
        },
      ],
    },
  },
};

test("forum detail records one view per browser visitor and UTC day", async ({ page, context }) => {
  await context.clearCookies();
  await signInAsE2EAdmin(page);
  const headers = await csrfHeaders(context);
  const key = `engagement-${Date.now().toString(36)}`;
  const boardResponse = await page.request.post("/api/collections/forum-boards", {
    headers,
    data: {
      key,
      name: "Engagement board",
      skin: "community-full",
      writeMode: "members",
      moderation: "published",
      commentsEnabled: true,
      pageSize: 20,
      categories: [],
      _status: "published",
    },
  });
  expect(boardResponse.status()).toBe(201);
  const board = (await boardResponse.json()) as { id?: unknown };
  expect(typeof board.id).toBe("string");
  if (typeof board.id !== "string") throw new Error("Forum board id was not returned.");

  const postResponse = await page.request.post("/api/collections/forum-posts", {
    headers,
    data: {
      board: board.id,
      title: "Forum engagement E2E",
      body: richTextBody,
      _status: "published",
    },
  });
  expect(postResponse.status()).toBe(201);
  const post = (await postResponse.json()) as { id?: unknown };
  expect(typeof post.id).toBe("string");
  if (typeof post.id !== "string") throw new Error("Forum post id was not returned.");

  await context.clearCookies();
  await page.goto(`/boards/${key}/${post.id}`);
  const views = page.locator('[data-np-forum-metric="views"] strong').first();
  await expect(views).toHaveText("1", { timeout: 15_000 });
  const visitor = (await context.cookies()).find((cookie) => cookie.name === "np-visitor");
  expect(visitor?.httpOnly).toBe(true);

  await page.reload();
  await expect(views).toHaveText("1", { timeout: 15_000 });

  await context.clearCookies();
  await page.reload();
  await expect(views).toHaveText("2", { timeout: 15_000 });
});

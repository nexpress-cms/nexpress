import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { forumCollections } from "@nexpress/plugin-forum";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import {
  DELETE as collectionDELETE,
  PATCH as collectionPATCH,
} from "@/app/api/collections/[slug]/[id]/route";
import { forumBoardsTable, forumPostsTable } from "@/db/generated/collections";
import { NextRequest } from "next/server";

import {
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

function request(
  path: string,
  session: { cookie: string; csrfCookie: string; csrfHeader: string },
  init: RequestInit,
): NextRequest {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("cookie", `${session.cookie}; ${session.csrfCookie}`);
  headers.set("x-csrf-token", session.csrfHeader);
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

describe.skipIf(skipIfNoTestDb())("forum board member policy", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { registerCollection } = await import("@nexpress/core");
    registerCollection("forum-boards", forumBoardsTable as never, forumCollections[0]);
    registerCollection("forum-posts", forumPostsTable as never, forumCollections[1]);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function createBoard(input: {
    key: string;
    moderation?: "published" | "pending";
    commentsEnabled?: boolean;
    status?: "draft" | "published";
    writeMode?: "members" | "staff" | "closed";
  }): Promise<{ id: string; staff: Awaited<ReturnType<typeof seedUser>> }> {
    const staff = await seedUser({ role: "editor" });
    const response = await collectionPOST(
      request(
        "/api/collections/forum-boards",
        {
          cookie: `np-session=${staff.accessToken}`,
          csrfCookie: `np-csrf=${staff.csrfToken}`,
          csrfHeader: staff.csrfToken,
        },
        {
          method: "POST",
          body: JSON.stringify({
            key: input.key,
            name: input.key,
            skin: "classic",
            writeMode: input.writeMode ?? "members",
            moderation: input.moderation ?? "published",
            commentsEnabled: input.commentsEnabled ?? true,
            pageSize: 20,
            categories: [{ key: "question", label: "질문" }],
            _status: input.status ?? "published",
          }),
        },
      ),
      { params: Promise.resolve({ slug: "forum-boards" }) },
    );
    const result = await readJson<{ id: string }>(response);
    expect(result.status).toBe(201);
    return { id: result.body.id, staff };
  }

  async function createPost(
    boardId: string,
    body: Record<string, unknown> = {},
  ): Promise<{ response: Response; member: Awaited<ReturnType<typeof seedActiveMember>> }> {
    const member = await seedActiveMember({
      handle: `writer-${Math.random().toString(36).slice(2)}`,
    });
    const response = await collectionPOST(
      request(
        "/api/collections/forum-posts",
        {
          cookie: `np-mb-session=${member.sessionCookie}`,
          csrfCookie: `np-mb-csrf=${member.csrfCookie}`,
          csrfHeader: member.csrfCookie,
        },
        {
          method: "POST",
          body: JSON.stringify({
            board: boardId,
            title: "한글 제목은 URL 계약과 분리됩니다",
            body: npCreateEmptyRichTextContent(),
            category: "question",
            ...body,
          }),
        },
      ),
      { params: Promise.resolve({ slug: "forum-posts" }) },
    );
    return { response, member };
  }

  it("rejects member writes to operator-only fields before persistence", async () => {
    const { id: boardId } = await createBoard({ key: "free" });
    const { response } = await createPost(boardId, { pinned: true });
    const result = await readJson<{ error: { details: Array<{ field: string }> } }>(response);
    expect(result.status).toBe(400);
    expect(result.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "pinned" })]),
    );
  });

  it("derives pending status and comment locking from the selected board", async () => {
    const { id: boardId } = await createBoard({
      key: "questions",
      moderation: "pending",
      commentsEnabled: false,
    });
    const { response } = await createPost(boardId);
    const result = await readJson<{ status: string; locked: boolean }>(response);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ status: "pending", locked: true });
  });

  it("prevents an author from moving a post between boards", async () => {
    const { id: sourceBoard } = await createBoard({ key: "source" });
    const { id: targetBoard } = await createBoard({ key: "target" });
    const { response, member } = await createPost(sourceBoard);
    const created = await readJson<{ id: string }>(response);
    expect(created.status).toBe(201);

    const update = await collectionPATCH(
      request(
        `/api/collections/forum-posts/${created.body.id}`,
        {
          cookie: `np-mb-session=${member.sessionCookie}`,
          csrfCookie: `np-mb-csrf=${member.csrfCookie}`,
          csrfHeader: member.csrfCookie,
        },
        {
          method: "PATCH",
          body: JSON.stringify({ board: targetBoard }),
        },
      ),
      { params: Promise.resolve({ slug: "forum-posts", id: created.body.id }) },
    );
    expect(update.status).toBe(403);
  });

  it("lets staff manage posts on draft boards while validating their categories", async () => {
    const { id: boardId, staff } = await createBoard({ key: "staff", status: "draft" });
    const staffSession = {
      cookie: `np-session=${staff.accessToken}`,
      csrfCookie: `np-csrf=${staff.csrfToken}`,
      csrfHeader: staff.csrfToken,
    };
    const invalid = await collectionPOST(
      request("/api/collections/forum-posts", staffSession, {
        method: "POST",
        body: JSON.stringify({
          board: boardId,
          title: "Invalid category",
          body: npCreateEmptyRichTextContent(),
          category: "missing",
          _status: "draft",
        }),
      }),
      { params: Promise.resolve({ slug: "forum-posts" }) },
    );
    expect(invalid.status).toBe(400);

    const valid = await collectionPOST(
      request("/api/collections/forum-posts", staffSession, {
        method: "POST",
        body: JSON.stringify({
          board: boardId,
          title: "Draft-board post",
          body: npCreateEmptyRichTextContent(),
          category: "question",
          _status: "draft",
        }),
      }),
      { params: Promise.resolve({ slug: "forum-posts" }) },
    );
    const result = await readJson<{ boardKey: string }>(valid);
    expect(result.status).toBe(201);
    expect(result.body.boardKey).toBe("staff");
  });

  it("prevents staff and members from creating new posts on a closed board", async () => {
    const { id: boardId, staff } = await createBoard({ key: "closed", writeMode: "closed" });
    const staffResponse = await collectionPOST(
      request(
        "/api/collections/forum-posts",
        {
          cookie: `np-session=${staff.accessToken}`,
          csrfCookie: `np-csrf=${staff.csrfToken}`,
          csrfHeader: staff.csrfToken,
        },
        {
          method: "POST",
          body: JSON.stringify({
            board: boardId,
            title: "Closed",
            body: npCreateEmptyRichTextContent(),
            category: "question",
            _status: "published",
          }),
        },
      ),
      { params: Promise.resolve({ slug: "forum-posts" }) },
    );
    expect(staffResponse.status).toBe(403);

    const { response: memberResponse } = await createPost(boardId);
    expect(memberResponse.status).toBe(403);
  });

  it("reports the board deletion invariant before the database foreign key", async () => {
    const { id: boardId, staff } = await createBoard({ key: "kept" });
    const created = await collectionPOST(
      request(
        "/api/collections/forum-posts",
        {
          cookie: `np-session=${staff.accessToken}`,
          csrfCookie: `np-csrf=${staff.csrfToken}`,
          csrfHeader: staff.csrfToken,
        },
        {
          method: "POST",
          body: JSON.stringify({
            board: boardId,
            title: "Keep board",
            body: npCreateEmptyRichTextContent(),
            category: "question",
            _status: "published",
          }),
        },
      ),
      { params: Promise.resolve({ slug: "forum-posts" }) },
    );
    expect(created.status).toBe(201);

    const removed = await collectionDELETE(
      request(
        `/api/collections/forum-boards/${boardId}`,
        {
          cookie: `np-session=${staff.accessToken}`,
          csrfCookie: `np-csrf=${staff.csrfToken}`,
          csrfHeader: staff.csrfToken,
        },
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ slug: "forum-boards", id: boardId }) },
    );
    const result = await readJson<{ error: { message: string } }>(removed);
    expect(result.status).toBe(400);
    expect(result.body.error.message).toMatch(/still has posts/u);
  });
});

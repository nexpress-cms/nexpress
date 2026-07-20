import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { forumCollections } from "@nexpress/plugin-forum";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import {
  DELETE as collectionDELETE,
  PATCH as collectionPATCH,
} from "@/app/api/collections/[slug]/[id]/route";
import { POST as viewPOST } from "@/app/api/views/route";
import { forumBoardsTable, forumPostsTable } from "@/db/generated/collections";
import type { ForumPostsDocument } from "@/db/generated/documents";
import { NextRequest } from "next/server";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
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

  it("keeps full-text discovery inside the selected board and category", async () => {
    const { id: sourceBoard } = await createBoard({ key: "search-source" });
    const { id: otherBoard } = await createBoard({ key: "search-other" });
    const source = await createPost(sourceBoard, { title: "한글 검색 가이드" });
    const uncategorized = await createPost(sourceBoard, {
      title: "한글 검색 가이드",
      category: null,
    });
    const other = await createPost(otherBoard, { title: "한글 검색 가이드" });
    expect(source.response.status).toBe(201);
    expect(uncategorized.response.status).toBe(201);
    expect(other.response.status).toBe(201);

    const { findDocuments } = await import("@nexpress/core");
    const found = await findDocuments<ForumPostsDocument>("forum-posts", {
      search: "검색 가이드",
      where: {
        board: sourceBoard,
        category: "question",
        status: "published",
        pinned: false,
      },
      page: 1,
      limit: 20,
    });
    const created = await readJson<{ id: string }>(source.response);

    expect(found.totalDocs).toBe(1);
    expect(found.docs.map((post) => post.id)).toEqual([created.body.id]);
  });

  it("deduplicates daily views and aggregates document comments and reactions without orphans", async () => {
    const { id: boardId } = await createBoard({ key: "engagement" });
    const { response, member: author } = await createPost(boardId, {
      title: "참여 계약",
    });
    const created = await readJson<{ id: string }>(response);
    expect(created.status).toBe(201);
    const reactor = await seedActiveMember({
      handle: `reactor-${Math.random().toString(36).slice(2)}`,
    });
    const {
      addReaction,
      createComment,
      npContentViews,
      npListContentEngagement,
      npRecordContentView,
    } = await import("@nexpress/core");

    await createComment({
      targetType: "forum-posts",
      targetId: created.body.id,
      memberId: reactor.memberId,
      bodyMd: "집계되는 댓글",
    });
    await addReaction({
      targetType: "forum-posts",
      targetId: created.body.id,
      memberId: reactor.memberId,
      kind: "like",
    });

    const viewerHash = "a".repeat(64);
    expect(
      await npRecordContentView(
        { targetType: "forum-posts", targetId: created.body.id, viewerHash },
        { now: new Date("2026-07-20T01:00:00.000Z") },
      ),
    ).toEqual({ counted: true, viewCount: 1 });
    expect(
      await npRecordContentView(
        { targetType: "forum-posts", targetId: created.body.id, viewerHash },
        { now: new Date("2026-07-20T23:59:59.000Z") },
      ),
    ).toEqual({ counted: false, viewCount: 1 });
    expect(
      await npRecordContentView(
        { targetType: "forum-posts", targetId: created.body.id, viewerHash },
        { now: new Date("2026-07-21T00:00:00.000Z") },
      ),
    ).toEqual({ counted: true, viewCount: 2 });

    await expect(npListContentEngagement("forum-posts", [created.body.id])).resolves.toEqual([
      {
        targetType: "forum-posts",
        targetId: created.body.id,
        viewCount: 2,
        commentCount: 1,
        reactionCount: 1,
        reactions: { like: 1 },
      },
    ]);
    const db = await getTestDb();
    const persistedViews = await db.select().from(npContentViews);
    expect(persistedViews).toHaveLength(2);
    expect(persistedViews.every((row) => row.viewerHash !== viewerHash)).toBe(true);
    expect(new Set(persistedViews.map((row) => row.viewerHash))).toHaveProperty("size", 2);

    const removed = await collectionDELETE(
      request(
        `/api/collections/forum-posts/${created.body.id}`,
        {
          cookie: `np-mb-session=${author.sessionCookie}`,
          csrfCookie: `np-mb-csrf=${author.csrfCookie}`,
          csrfHeader: author.csrfCookie,
        },
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ slug: "forum-posts", id: created.body.id }) },
    );
    expect(removed.status).toBe(204);
    expect(await db.select().from(npContentViews)).toHaveLength(0);
  });

  it("keeps the anonymous visitor id HttpOnly and returns a stable daily view receipt", async () => {
    const { id: boardId } = await createBoard({ key: "view-api" });
    const { response } = await createPost(boardId, { title: "조회 API" });
    const created = await readJson<{ id: string }>(response);
    expect(created.status).toBe(201);
    const body = JSON.stringify({ targetType: "forum-posts", targetId: created.body.id });

    const first = await viewPOST(
      new NextRequest("http://localhost:3000/api/views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
    const firstResult = await readJson<{ counted: boolean; viewCount: number }>(first);
    expect(firstResult).toEqual({ status: 200, body: { counted: true, viewCount: 1 } });
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^np-visitor=[^;]+;/u);
    expect(setCookie).toContain("HttpOnly");
    const visitorCookie = setCookie.split(";", 1)[0];

    const second = await viewPOST(
      new NextRequest("http://localhost:3000/api/views", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: visitorCookie ?? "" },
        body,
      }),
    );
    await expect(readJson<{ counted: boolean; viewCount: number }>(second)).resolves.toEqual({
      status: 200,
      body: { counted: false, viewCount: 1 },
    });
    expect(second.headers.get("set-cookie")).toBeNull();
  });
});

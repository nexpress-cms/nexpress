import { describe, expect, it } from "vitest";

import { isForumPostId, normalizeForumBoard, normalizeForumCategories } from "./runtime.js";

describe("forum runtime contracts", () => {
  it("accepts only canonical UUID-shaped post route ids", () => {
    expect(isForumPostId("2d4af53e-6f78-43e0-8682-67f5a7d2b92e")).toBe(true);
    expect(isForumPostId("not-a-post-id")).toBe(false);
    expect(isForumPostId("2d4af53e-6f78-03e0-8682-67f5a7d2b92e")).toBe(false);
  });

  it("normalizes a persisted board into the skin contract", () => {
    expect(
      normalizeForumBoard({
        id: "board-1",
        status: "published",
        visibility: "public",
        slug: "free",
        name: "자유게시판",
        description: "  함께 이야기해요  ",
        skin: "classic",
        audience: "members",
        writeMode: "members",
        moderation: "pending",
        commentsEnabled: true,
        pageSize: 20,
        attachmentsEnabled: true,
        maxAttachments: 5,
        maxAttachmentSizeMb: 20,
        categories: [{ key: "question", label: " 질문 " }],
      }),
    ).toEqual({
      id: "board-1",
      key: "free",
      name: "자유게시판",
      description: "함께 이야기해요",
      skinId: "classic",
      audience: "members",
      writeMode: "members",
      moderation: "pending",
      commentsEnabled: true,
      pageSize: 20,
      categories: [{ key: "question", label: "질문" }],
      attachments: {
        enabled: true,
        maxFiles: 5,
        maxFileSizeBytes: 20 * 1024 * 1024,
      },
    });
  });

  it("rejects malformed and duplicate category keys", () => {
    expect(() => normalizeForumCategories([{ key: "질문", label: "질문" }])).toThrow(
      /invalid key/u,
    );
    expect(() =>
      normalizeForumCategories([
        { key: "question", label: "질문" },
        { key: "question", label: "중복" },
      ]),
    ).toThrow(/duplicated/u);
  });

  it("rejects unsafe persisted board policy values", () => {
    const base = {
      id: "board-1",
      status: "published",
      visibility: "public",
      slug: "free",
      name: "Free",
      skin: "classic",
      audience: "public",
      writeMode: "members",
      moderation: "published",
      commentsEnabled: true,
      pageSize: 20,
      attachmentsEnabled: true,
      maxAttachments: 5,
      maxAttachmentSizeMb: 20,
    };
    expect(() => normalizeForumBoard({ ...base, writeMode: "everyone" })).toThrow(/write mode/u);
    expect(() => normalizeForumBoard({ ...base, audience: "friends" })).toThrow(/audience/u);
    expect(() => normalizeForumBoard({ ...base, pageSize: 0 })).toThrow(/page size/u);
    expect(() => normalizeForumBoard({ ...base, maxAttachments: 21 })).toThrow(/attachment/u);
    expect(() => normalizeForumBoard({ ...base, maxAttachmentSizeMb: 26 })).toThrow(/attachment/u);
  });
});

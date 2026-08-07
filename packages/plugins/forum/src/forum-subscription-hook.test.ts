import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(() => Promise.resolve(null)),
  notifyFollowers: vi.fn(() => Promise.resolve(1)),
  registerNotificationKind: vi.fn(),
}));

vi.mock("@nexpress/core/community", () => ({
  createNotification: mocks.createNotification,
  notifyFollowers: mocks.notifyFollowers,
  registerNotificationKind: mocks.registerNotificationKind,
}));

import { createForum } from "./index.js";

type HookInput = {
  data: {
    collection: string;
    document: Readonly<Record<string, unknown>>;
    principal: { kind: "member"; memberId: string } | null;
  };
};

type UpdateHookInput = {
  data: {
    collection: string;
    originalDocument: Readonly<Record<string, unknown>> | null;
    document: Readonly<Record<string, unknown>>;
  };
};

describe("forum board subscription hook", () => {
  beforeEach(() => {
    mocks.notifyFollowers.mockClear();
    mocks.createNotification.mockClear();
    mocks.registerNotificationKind.mockClear();
  });

  it("registers the official-answer notification preference", async () => {
    const forum = createForum();
    await forum.plugin.setup?.({} as never);
    expect(mocks.registerNotificationKind).toHaveBeenCalledWith({
      kind: "forum.question-answered",
      label: "Official answers",
      description: "Staff posted an official answer to one of your contextual questions.",
    });
  });

  it("notifies the member author on the first official-answer transition", async () => {
    const forum = createForum();
    const handler = forum.plugin.hooks?.["content:afterUpdate"] as (
      input: UpdateHookInput,
    ) => Promise<void>;
    await handler({
      data: {
        collection: "forum-posts",
        originalDocument: { answeredAt: null },
        document: {
          id: "11111111-1111-4111-8111-111111111111",
          boardKey: "product-questions",
          memberAuthorId: "44444444-4444-4444-8444-444444444444",
          title: "배송일이 궁금합니다",
          answeredAt: new Date("2026-08-07T00:00:00.000Z"),
        },
      },
    });

    expect(mocks.createNotification).toHaveBeenCalledWith({
      memberId: "44444444-4444-4444-8444-444444444444",
      kind: "forum.question-answered",
      payload: {
        href: "/boards/product-questions/11111111-1111-4111-8111-111111111111",
        title: "배송일이 궁금합니다",
        targetType: "forum-posts",
        targetId: "11111111-1111-4111-8111-111111111111",
      },
    });
  });

  it("does not notify again while an official answer remains present", async () => {
    const forum = createForum();
    const handler = forum.plugin.hooks?.["content:afterUpdate"] as (
      input: UpdateHookInput,
    ) => Promise<void>;
    await handler({
      data: {
        collection: "forum-posts",
        originalDocument: { answeredAt: new Date("2026-08-06T00:00:00.000Z") },
        document: {
          id: "11111111-1111-4111-8111-111111111111",
          boardKey: "product-questions",
          memberAuthorId: "44444444-4444-4444-8444-444444444444",
          answeredAt: new Date("2026-08-07T00:00:00.000Z"),
        },
      },
    });
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("fans a newly published public post out to board subscribers", async () => {
    const forum = createForum();
    const registration = forum.plugin.hooks?.["content:afterPublish"];
    expect(typeof registration).toBe("function");
    const handler = registration as (input: HookInput) => Promise<void>;

    await handler({
      data: {
        collection: "forum-posts",
        document: {
          id: "11111111-1111-4111-8111-111111111111",
          board: "22222222-2222-4222-8222-222222222222",
          boardKey: "free",
          visibility: "public",
          memberAuthorId: "33333333-3333-4333-8333-333333333333",
        },
        principal: { kind: "member", memberId: "33333333-3333-4333-8333-333333333333" },
      },
    });

    expect(mocks.notifyFollowers).toHaveBeenCalledWith({
      activity: "document.published",
      subjectType: "forum-boards",
      subjectId: "22222222-2222-4222-8222-222222222222",
      targetType: "forum-posts",
      targetId: "11111111-1111-4111-8111-111111111111",
      href: "/boards/free/11111111-1111-4111-8111-111111111111",
      commentId: null,
      actorMemberId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("ignores private and unrelated publish events", async () => {
    const forum = createForum();
    const handler = forum.plugin.hooks?.["content:afterPublish"] as (
      input: HookInput,
    ) => Promise<void>;
    await handler({
      data: {
        collection: "posts",
        document: { visibility: "public" },
        principal: null,
      },
    });
    await handler({
      data: {
        collection: "forum-posts",
        document: { visibility: "private" },
        principal: null,
      },
    });
    expect(mocks.notifyFollowers).not.toHaveBeenCalled();
  });

  it("excludes the member author when staff publishes a moderated post", async () => {
    const forum = createForum();
    const handler = forum.plugin.hooks?.["content:afterPublish"] as (
      input: HookInput,
    ) => Promise<void>;
    await handler({
      data: {
        collection: "forum-posts",
        document: {
          id: "11111111-1111-4111-8111-111111111111",
          board: "22222222-2222-4222-8222-222222222222",
          boardKey: "free",
          visibility: "public",
          memberAuthorId: "44444444-4444-4444-8444-444444444444",
        },
        principal: null,
      },
    });
    expect(mocks.notifyFollowers).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMemberId: "44444444-4444-4444-8444-444444444444",
      }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  capabilities: vi.fn(),
  resolveTarget: vi.fn(),
}));

vi.mock("../collections/registry.js", () => ({
  getCollectionConfig: () => ({
    community: {
      memberWrite: { update: true, delete: true },
      moderation: {
        hiddenField: "moderationHidden",
        lockField: "locked",
        pinField: "pinned",
      },
    },
  }),
}));
vi.mock("../collections/pipeline.js", () => ({
  npApplyMemberThreadModeration: mocks.apply,
}));
vi.mock("./can.js", () => ({
  memberCapabilities: mocks.capabilities,
}));
vi.mock("./target-scopes.js", () => ({
  npResolveDocumentCommunityTarget: mocks.resolveTarget,
  npIsMemberModeratableDocument: (_config: unknown, document: Record<string, unknown>) =>
    typeof document.memberAuthorId === "string" ||
    (document.status === "published" && document.visibility === "public") ||
    document.moderationHidden === true,
}));

import { getDocumentModerationPermissions, moderateMemberThread } from "./document-moderation.js";

describe("document moderation surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTarget.mockResolvedValue({
      ownerId: "owner-1",
      scopes: [
        { type: "thread", id: "thread-1" },
        { type: "category", id: "board-1" },
        { type: "collection", id: "forum-posts" },
      ],
      document: {
        status: "published",
        visibility: "public",
        memberAuthorId: "owner-1",
        locked: false,
        pinned: true,
      },
    });
    mocks.capabilities.mockResolvedValue(
      new Set([
        "view-staff-tools",
        "edit-any-thread",
        "delete-any-thread",
        "hide-thread",
        "lock-thread",
        "unpin-thread",
        "hide-comment",
        "resolve-report",
      ]),
    );
  });

  it("builds one exact state-aware action and comment permission snapshot", async () => {
    await expect(
      getDocumentModerationPermissions("moderator-1", "forum-posts", "thread-1"),
    ).resolves.toEqual({
      viewStaffTools: true,
      editThread: true,
      deleteThread: true,
      editComments: false,
      deleteComments: false,
      hideComments: true,
      restoreComments: false,
      resolveReports: true,
      actions: ["hide", "lock", "unpin"],
    });
    expect(mocks.capabilities).toHaveBeenCalledTimes(1);
    expect(mocks.capabilities).toHaveBeenCalledWith(
      "moderator-1",
      expect.any(Array),
      expect.objectContaining({
        id: "thread-1",
        ownerId: "owner-1",
        scopes: expect.arrayContaining([{ type: "category", id: "board-1" }]),
      }),
    );
  });

  it("delegates only the typed moderation request to the collection pipeline", async () => {
    const saved = { doc: { id: "thread-1", locked: true }, operation: "update" };
    mocks.apply.mockResolvedValue(saved);

    await expect(
      moderateMemberThread({
        collection: "forum-posts",
        documentId: "thread-1",
        memberId: "moderator-1",
        action: "lock",
      }),
    ).resolves.toBe(saved);
    expect(mocks.apply).toHaveBeenCalledWith({
      collection: "forum-posts",
      documentId: "thread-1",
      memberId: "moderator-1",
      action: "lock",
    });
  });

  it("never offers initial publication of a staff-authored draft", async () => {
    mocks.resolveTarget.mockResolvedValue({
      ownerId: null,
      scopes: [{ type: "collection", id: "forum-posts" }],
      document: { status: "pending", moderationHidden: false },
    });
    mocks.capabilities.mockResolvedValue(new Set(["restore-thread"]));

    await expect(
      getDocumentModerationPermissions("moderator-1", "forum-posts", "thread-1"),
    ).resolves.toMatchObject({ actions: [], editThread: false, deleteThread: false });
  });
});

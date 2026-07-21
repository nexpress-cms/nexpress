import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureFor: vi.fn(() => Promise.resolve()),
  moderateMemberThread: vi.fn(),
  requireMember: vi.fn(() => Promise.resolve({ id: "member-1" })),
  revalidateCollection: vi.fn(() => Promise.resolve()),
}));

vi.mock("@nexpress/core/community", () => ({
  moderateMemberThread: mocks.moderateMemberThread,
}));
vi.mock("../../../../../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));
vi.mock("../../../../../lib/member-auth-helpers", () => ({
  requireMember: mocks.requireMember,
}));
vi.mock("../../../../../lib/revalidate", () => ({
  revalidateCollection: mocks.revalidateCollection,
}));

import { POST } from "./route.js";

const postId = "33204610-bdf5-44f5-b9a4-2f0ab7f0a5c6";

function request(body: unknown) {
  return new Request(`http://localhost/api/collections/forum-posts/${postId}/moderation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("member thread moderation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moderateMemberThread.mockResolvedValue({
      doc: { id: postId, status: "pending" },
      operation: "update",
    });
  });

  it("passes one closed action through the member principal and revalidates", async () => {
    const response = await POST(request({ action: "hide", reason: "spam" }), {
      params: Promise.resolve({ slug: "forum-posts", id: postId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.moderateMemberThread).toHaveBeenCalledWith({
      collection: "forum-posts",
      documentId: postId,
      memberId: "member-1",
      action: "hide",
      reason: "spam",
    });
    expect(mocks.revalidateCollection).toHaveBeenCalledWith("forum-posts", {
      id: postId,
      status: "pending",
    });
  });

  it("rejects unknown actions before dispatch", async () => {
    const response = await POST(request({ action: "publish" }), {
      params: Promise.resolve({ slug: "forum-posts", id: postId }),
    });

    expect(response.status).toBe(400);
    expect(mocks.moderateMemberThread).not.toHaveBeenCalled();
  });

  it("rejects malformed document ids before dispatch", async () => {
    const response = await POST(request({ action: "hide" }), {
      params: Promise.resolve({ slug: "forum-posts", id: "not-a-document-id" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.moderateMemberThread).not.toHaveBeenCalled();
  });
});

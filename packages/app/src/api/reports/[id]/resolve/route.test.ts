import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureFor: vi.fn(() => Promise.resolve()),
  resolveReport: vi.fn(),
  requireMember: vi.fn(() => Promise.resolve({ id: "ca8718ee-a2f4-450d-a454-5446a8ec093d" })),
  revalidateCollection: vi.fn(() => Promise.resolve()),
}));

vi.mock("@nexpress/core/community", () => ({ resolveReport: mocks.resolveReport }));
vi.mock("../../../../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));
vi.mock("../../../../lib/member-auth-helpers", () => ({
  requireMember: mocks.requireMember,
}));
vi.mock("../../../../lib/revalidate", () => ({
  revalidateCollection: mocks.revalidateCollection,
}));

import { POST } from "./route.js";

const reportId = "726e5941-c303-4905-bd67-77c3edd9e221";
const memberId = "ca8718ee-a2f4-450d-a454-5446a8ec093d";

function request(body: unknown) {
  return new Request(`http://localhost/api/reports/${reportId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("member report resolution API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveReport.mockResolvedValue({
      report: {
        id: reportId,
        reporterId: "03949852-6cc3-42ef-8043-cf2aa4758b17",
        targetType: "forum-posts",
        targetId: "33204610-bdf5-44f5-b9a4-2f0ab7f0a5c6",
        reason: "spam",
        resolvedAt: new Date("2026-07-21T00:00:00.000Z"),
        resolvedByUserId: null,
        resolvedByMemberId: memberId,
        resolution: "unpublish-document",
        siteId: "default",
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
      },
      moderatedDocument: {
        collectionSlug: "forum-posts",
        document: { id: "33204610-bdf5-44f5-b9a4-2f0ab7f0a5c6", status: "pending" },
      },
    });
  });

  it("uses a member actor and revalidates a changed document", async () => {
    const response = await POST(request({ action: "unpublish-document" }), {
      params: Promise.resolve({ id: reportId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.resolveReport).toHaveBeenCalledWith({
      reportId,
      action: "unpublish-document",
      actor: { kind: "member", memberId },
    });
    expect(mocks.revalidateCollection).toHaveBeenCalledWith("forum-posts", {
      id: "33204610-bdf5-44f5-b9a4-2f0ab7f0a5c6",
      status: "pending",
    });
    await expect(response.json()).resolves.toMatchObject({
      id: reportId,
      resolvedByMemberId: memberId,
      resolvedAt: "2026-07-21T00:00:00.000Z",
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findDocumentsMock = vi.fn();

vi.mock("@nexpress/core", () => ({
  findDocuments: (...args: unknown[]) => findDocumentsMock(...args),
}));

const { createDefaultBlockRenderContext } = await import("./block-render-context.js");

describe("createDefaultBlockRenderContext", () => {
  beforeEach(() => {
    findDocumentsMock.mockReset();
  });

  afterEach(() => {
    findDocumentsMock.mockReset();
  });

  describe("findOne", () => {
    it("routes through findDocuments with id + published default", async () => {
      // Issue #475 — findOne must go through findDocuments so the
      // anonymous-visitor visibility filter and the published-status
      // default both apply. A direct getDocumentById call would only
      // see access.read({ user, doc }), which lets draft / private
      // rows leak whenever a collection's read returns true for null
      // users.
      findDocumentsMock.mockResolvedValue({
        docs: [{ id: "doc-1", title: "Hi" }],
        totalDocs: 1,
        totalPages: 1,
        page: 1,
        limit: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });

      const ctx = createDefaultBlockRenderContext();
      const result = await ctx.content.findOne("posts", "doc-1");

      expect(result).toEqual({ id: "doc-1", title: "Hi" });
      expect(findDocumentsMock).toHaveBeenCalledTimes(1);
      expect(findDocumentsMock).toHaveBeenCalledWith(
        "posts",
        expect.objectContaining({
          where: expect.objectContaining({
            id: "doc-1",
            status: { equals: "published" },
          }),
          limit: 1,
        }),
      );
      // Crucially, no `user` argument — `findDocuments` treats the
      // null/missing principal as the anonymous case and auto-applies
      // `visibility = "public"` inside the pipeline.
      const lastCall = findDocumentsMock.mock.calls[0];
      expect(lastCall.length).toBe(2);
    });

    it("returns null when findDocuments yields no docs", async () => {
      findDocumentsMock.mockResolvedValue({
        docs: [],
        totalDocs: 0,
        totalPages: 0,
        page: 1,
        limit: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });

      const ctx = createDefaultBlockRenderContext();
      const result = await ctx.content.findOne("posts", "missing");

      expect(result).toBeNull();
    });
  });

  describe("find", () => {
    it("applies published default when caller didn't specify status", async () => {
      findDocumentsMock.mockResolvedValue({
        docs: [],
        totalDocs: 0,
        totalPages: 0,
        page: 1,
        limit: 10,
        hasNextPage: false,
        hasPrevPage: false,
      });

      const ctx = createDefaultBlockRenderContext();
      await ctx.content.find("posts", { limit: 10 });

      const callArgs = findDocumentsMock.mock.calls[0]?.[1] as {
        where?: { status?: unknown };
      };
      expect(callArgs?.where?.status).toEqual({ equals: "published" });
    });

    it("respects caller-specified status", async () => {
      findDocumentsMock.mockResolvedValue({
        docs: [],
        totalDocs: 0,
        totalPages: 0,
        page: 1,
        limit: 10,
        hasNextPage: false,
        hasPrevPage: false,
      });

      const ctx = createDefaultBlockRenderContext();
      await ctx.content.find("posts", {
        where: { status: { equals: "draft" } },
      });

      const callArgs = findDocumentsMock.mock.calls[0]?.[1] as {
        where?: { status?: unknown };
      };
      expect(callArgs?.where?.status).toEqual({ equals: "draft" });
    });
  });
});

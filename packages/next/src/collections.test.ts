import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NxValidationError } from "@nexpress/core";

// Mock core's pipeline entry points so we can verify the helpers forward args
// correctly without needing a live DB.
vi.mock("@nexpress/core", async () => {
  const actual = await vi.importActual<typeof import("@nexpress/core")>("@nexpress/core");
  return {
    ...actual,
    findDocuments: vi.fn(),
    getDocumentById: vi.fn(),
    saveDocument: vi.fn(),
    deleteDocument: vi.fn(),
  };
});

const core = await import("@nexpress/core");
const { createCollectionHelpers } = await import("./collections.js");

function buildHelpers(ensureReady = vi.fn().mockResolvedValue(undefined)) {
  return { helpers: createCollectionHelpers({ ensureReady }), ensureReady };
}

describe("parseFindOptions", () => {
  const { helpers } = buildHelpers();

  it("returns empty options for an empty URLSearchParams", () => {
    expect(helpers.parseFindOptions(new URLSearchParams())).toEqual({
      page: undefined,
      limit: undefined,
      sort: undefined,
      search: undefined,
      where: undefined,
    });
  });

  it("parses integer page and limit", () => {
    const out = helpers.parseFindOptions(new URLSearchParams("page=3&limit=25"));
    expect(out.page).toBe(3);
    expect(out.limit).toBe(25);
  });

  it("rejects a non-positive page", () => {
    expect(() => helpers.parseFindOptions(new URLSearchParams("page=0"))).toThrow(
      NxValidationError,
    );
  });

  it("caps limit at 100", () => {
    expect(() => helpers.parseFindOptions(new URLSearchParams("limit=101"))).toThrow(
      NxValidationError,
    );
  });

  it("parses a JSON where filter", () => {
    const out = helpers.parseFindOptions(
      new URLSearchParams(`where=${encodeURIComponent('{"status":"published"}')}`),
    );
    expect(out.where).toEqual({ status: "published" });
  });

  it("rejects a non-JSON where", () => {
    expect(() =>
      helpers.parseFindOptions(new URLSearchParams("where=not-json")),
    ).toThrow(NxValidationError);
  });

  it("rejects a non-object where", () => {
    expect(() =>
      helpers.parseFindOptions(
        new URLSearchParams(`where=${encodeURIComponent("[1,2]")}`),
      ),
    ).toThrow(NxValidationError);
  });

  it("treats empty string sort/search as absent", () => {
    const out = helpers.parseFindOptions(new URLSearchParams("sort=&search="));
    expect(out.sort).toBeUndefined();
    expect(out.search).toBeUndefined();
  });
});

describe("collection operations", () => {
  beforeEach(() => {
    vi.mocked(core.findDocuments).mockReset();
    vi.mocked(core.getDocumentById).mockReset();
    vi.mocked(core.saveDocument).mockReset();
    vi.mocked(core.deleteDocument).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("awaits ensureReady before delegating to findDocuments", async () => {
    const calls: string[] = [];
    const ensureReady = vi.fn().mockImplementation(async () => {
      calls.push("ready");
    });
    vi.mocked(core.findDocuments).mockImplementation(async () => {
      calls.push("find");
      return {
        docs: [],
        totalDocs: 0,
        totalPages: 0,
        page: 1,
        limit: 10,
        hasNextPage: false,
        hasPrevPage: false,
      };
    });

    const { helpers } = buildHelpers(ensureReady);
    await helpers.findCollectionDocuments("posts", {}, null);

    expect(calls).toEqual(["ready", "find"]);
  });

  it("forwards user=null as undefined to the core pipeline", async () => {
    vi.mocked(core.findDocuments).mockResolvedValue({
      docs: [],
      totalDocs: 0,
      totalPages: 0,
      page: 1,
      limit: 10,
      hasNextPage: false,
      hasPrevPage: false,
    });

    const { helpers } = buildHelpers();
    await helpers.findCollectionDocuments("posts", { page: 2 }, null);

    expect(core.findDocuments).toHaveBeenCalledWith("posts", { page: 2 }, undefined);
  });

  it("saveCollectionDocument passes through to core.saveDocument", async () => {
    vi.mocked(core.saveDocument).mockResolvedValue({
      doc: { id: "new" },
      operation: "create",
    });

    const { helpers } = buildHelpers();
    const user = { id: "u", email: "u@x", name: "u", role: "admin" as const, tokenVersion: 0 };
    const result = await helpers.saveCollectionDocument("posts", null, { title: "x" }, user);

    expect(result.doc).toEqual({ id: "new" });
    expect(core.saveDocument).toHaveBeenCalledWith("posts", null, { title: "x" }, user);
  });

  it("deleteCollectionDocument awaits ensureReady even though it returns void", async () => {
    vi.mocked(core.deleteDocument).mockResolvedValue(undefined);

    const ensureReady = vi.fn().mockResolvedValue(undefined);
    const { helpers } = buildHelpers(ensureReady);
    const user = { id: "u", email: "u@x", name: "u", role: "admin" as const, tokenVersion: 0 };
    await helpers.deleteCollectionDocument("posts", "id-1", user);

    expect(ensureReady).toHaveBeenCalledOnce();
    expect(core.deleteDocument).toHaveBeenCalledWith("posts", "id-1", user);
  });
});

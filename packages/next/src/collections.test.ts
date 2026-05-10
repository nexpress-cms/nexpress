import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NpValidationError } from "@nexpress/core";
import type * as CoreModule from "@nexpress/core";

// Mock core's pipeline entry points so we can verify the helpers forward args
// correctly without needing a live DB.
vi.mock("@nexpress/core", async () => {
  const actual = await vi.importActual<typeof CoreModule>("@nexpress/core");
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
      NpValidationError,
    );
  });

  it("caps limit at 100", () => {
    expect(() => helpers.parseFindOptions(new URLSearchParams("limit=101"))).toThrow(
      NpValidationError,
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
    ).toThrow(NpValidationError);
  });

  it("rejects a non-object where", () => {
    expect(() =>
      helpers.parseFindOptions(
        new URLSearchParams(`where=${encodeURIComponent("[1,2]")}`),
      ),
    ).toThrow(NpValidationError);
  });

  it("treats empty string sort/search as absent", () => {
    const out = helpers.parseFindOptions(new URLSearchParams("sort=&search="));
    expect(out.sort).toBeUndefined();
    expect(out.search).toBeUndefined();
  });

  // ── #598 — strip reserved `where` keys at the trust boundary ──

  it("strips reserved `siteId` from user-supplied where (#598 cross-tenant smuggling guard)", () => {
    const out = helpers.parseFindOptions(
      new URLSearchParams(
        `where=${encodeURIComponent('{"siteId":"*","status":"published"}')}`,
      ),
    );
    // The pipeline interprets `siteId === "*"` as a trusted-caller
    // cross-tenant sentinel. An anonymous query parameter must not
    // be allowed to set it.
    expect(out.where).toEqual({ status: "published" });
    expect(out.where).not.toHaveProperty("siteId");
  });

  it("strips reserved `visibility` from user-supplied where (#598 visibility smuggling guard)", () => {
    const out = helpers.parseFindOptions(
      new URLSearchParams(
        `where=${encodeURIComponent('{"visibility":"*","status":"published"}')}`,
      ),
    );
    // `visibility === "*"` would drop the public-only filter for
    // anonymous reads, exposing private posts.
    expect(out.where).toEqual({ status: "published" });
    expect(out.where).not.toHaveProperty("visibility");
  });

  it("strips both reserved keys when present together", () => {
    const out = helpers.parseFindOptions(
      new URLSearchParams(
        `where=${encodeURIComponent(
          '{"siteId":"*","visibility":"*","status":"published","slug":"about"}',
        )}`,
      ),
    );
    expect(out.where).toEqual({ status: "published", slug: "about" });
  });

  it("preserves non-reserved keys verbatim", () => {
    const out = helpers.parseFindOptions(
      new URLSearchParams(
        `where=${encodeURIComponent(
          '{"author":"u-1","tag":"news","status":"published"}',
        )}`,
      ),
    );
    expect(out.where).toEqual({
      author: "u-1",
      tag: "news",
      status: "published",
    });
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
    const ensureReady = vi.fn().mockImplementation(() => {
      calls.push("ready");
      return Promise.resolve();
    });
    vi.mocked(core.findDocuments).mockImplementation(() => {
      calls.push("find");
      return Promise.resolve({
        docs: [],
        totalDocs: 0,
        totalPages: 0,
        page: 1,
        limit: 10,
        hasNextPage: false,
        hasPrevPage: false,
      });
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
    expect(core.saveDocument).toHaveBeenCalledWith("posts", null, { title: "x" }, user, undefined);
  });

  it("saveCollectionDocument forwards save options to core.saveDocument", async () => {
    vi.mocked(core.saveDocument).mockResolvedValue({
      doc: { id: "new" },
      operation: "create",
    });

    const { helpers } = buildHelpers();
    const user = { id: "u", email: "u@x", name: "u", role: "admin" as const, tokenVersion: 0 };
    await helpers.saveCollectionDocument("posts", null, { title: "x" }, user, { status: "draft" });

    expect(core.saveDocument).toHaveBeenCalledWith("posts", null, { title: "x" }, user, { status: "draft" });
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

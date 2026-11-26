import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAgentRuntimeRunContextV1 } from "@nexpress/core/agents";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  config: vi.fn(),
  read: vi.fn(),
  theme: vi.fn(),
  plugins: vi.fn(),
  blocks: vi.fn(),
}));
vi.mock("@nexpress/core", () => ({
  getActiveThemeId: mocks.theme,
  listEnabledPluginIds: mocks.plugins,
}));
vi.mock("@nexpress/core/sites", () => ({
  withCurrentSite: async (_siteId: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("@nexpress/blocks", () => ({ getRegisteredBlocksForActiveSources: mocks.blocks }));
vi.mock("@nexpress/core/collections", () => ({
  findDocuments: mocks.find,
  getCollectionConfig: mocks.config,
  getDb: () => context.db,
  npAssertCollectionReadAccess: mocks.read,
}));
import {
  npCreateAgentPublisherAppBlockFieldsV1,
  npCreateAgentPublisherAppRouteInventoryV1,
} from "./publisher-route-inventory";

const context = { siteId: "default", db: {} } as NpAgentRuntimeRunContextV1;
const document = (slug: string, extra: Record<string, unknown> = {}) => ({
  id: `unexposed-${slug}`,
  slug,
  siteId: "default",
  status: "published",
  visibility: "public",
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  ...extra,
});
function install(
  extra: Partial<Parameters<typeof npCreateAgentPublisherAppRouteInventoryV1>[0]> = {},
) {
  const authorize = vi.fn().mockResolvedValue(undefined);
  return {
    authorize,
    inventory: npCreateAgentPublisherAppRouteInventoryV1({
      authorize,
      collectionSlugs: ["posts"],
      fixedRoutes: [{ loc: "/" }],
      publicSurfaceComplete: true,
      ...extra,
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockReset().mockResolvedValue(undefined);
  mocks.config.mockReturnValue({
    seo: { urlPath: (doc: Record<string, unknown>) => `/${String(doc.slug)}` },
  });
  mocks.find.mockResolvedValue({
    docs: [document("library")],
    hasNextPage: false,
    totalDocs: 1,
  });
});
describe("Publisher canonical App route inventory", () => {
  it("derives bounded read fields from current active-source block declarations without opaque props", async () => {
    mocks.theme.mockResolvedValue("default");
    mocks.plugins.mockResolvedValue(["enabled"]);
    mocks.blocks.mockReturnValue([
      {
        type: "core.hero",
        propsSchema: [
          { name: "title", type: "text" },
          { name: "internal", type: "text", hiddenWhen: [["mode", "public"]] },
          { name: "entries", type: "array", itemSchema: [{ name: "heading", type: "textarea" }] },
        ],
      },
    ]);
    const authorize = vi.fn().mockResolvedValue(undefined);
    expect(await npCreateAgentPublisherAppBlockFieldsV1({ authorize })(context.siteId)).toEqual([
      {
        type: "core.hero",
        fields: [
          { name: "title", type: "text", hidden: false },
          { name: "internal", type: "text", hidden: true },
          {
            name: "entries",
            type: "array",
            hidden: false,
            fields: [{ name: "heading", type: "textarea", hidden: false }],
          },
        ],
      },
    ]);
    expect(mocks.blocks).toHaveBeenCalledWith({
      themeId: "default",
      pluginIds: new Set(["enabled"]),
    });
    expect(mocks.plugins).toHaveBeenCalledWith(context.db, context.siteId);
    expect(authorize).toHaveBeenCalledTimes(2);
  });
  it("omits document-specific anonymous ACL denials without route identities and marks coverage partial", async () => {
    mocks.find.mockResolvedValue({
      docs: [document("restricted"), document("library")],
      totalDocs: 2,
      hasNextPage: false,
    });
    mocks.read.mockImplementation((_config, _collection, user, doc) => {
      expect(user).toBeNull();
      if (doc.slug === "restricted") return Promise.reject(new Error("private rule details"));
      return Promise.resolve();
    });
    const result = await install().inventory(context);
    expect(result).toEqual({
      siteId: "default",
      complete: false,
      routes: [
        { path: "/", updatedAt: null },
        { path: "/library", updatedAt: "2025-01-01T00:00:00.000Z" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("restricted");
    expect(JSON.stringify(result)).not.toContain("private rule");
  });
  it("reads anonymous site-bound canonical paths through existing collection and SEO owners", async () => {
    const { inventory, authorize } = install();
    expect(await inventory(context)).toEqual({
      siteId: "default",
      complete: true,
      routes: [
        { path: "/", updatedAt: null },
        { path: "/library", updatedAt: "2025-01-01T00:00:00.000Z" },
      ],
    });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(mocks.find).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({
        where: { siteId: "default", status: "published", visibility: "public" },
        limit: 2000,
      }),
      undefined,
      { tx: context.db },
    );
  });
  it("requires current authorization and rechecks after reads", async () => {
    const first = install();
    first.authorize.mockRejectedValue(new Error("denied"));
    await expect(first.inventory(context)).rejects.toThrow("denied");
    expect(mocks.find).not.toHaveBeenCalled();
    const second = install();
    second.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    await expect(second.inventory(context)).rejects.toThrow("revoked");
  });
  it("never turns partial sources or swallowed failures into an absent-link conclusion", async () => {
    expect((await install({ publicSurfaceComplete: false }).inventory(context)).complete).toBe(
      false,
    );
    mocks.find.mockResolvedValue({ docs: [document("library")], totalDocs: 2, hasNextPage: true });
    expect((await install().inventory(context)).complete).toBe(false);
    mocks.find.mockRejectedValue(new Error("private source name must never escape"));
    const failed = await install().inventory(context);
    expect(failed).toEqual({
      siteId: "default",
      complete: false,
      routes: [{ path: "/", updatedAt: null }],
    });
    expect(JSON.stringify(failed)).not.toContain("private source");
    mocks.config.mockReturnValue({});
    expect((await install().inventory(context)).complete).toBe(false);
  });
  it("shares one source-row budget across collections and never promotes skipped sources to complete", async () => {
    const { inventory } = install({ collectionSlugs: ["stories", "posts"], documentLimit: 1 });
    const result = await inventory(context);
    expect(result.complete).toBe(false);
    expect(mocks.find).toHaveBeenCalledTimes(1);
    expect(mocks.find.mock.calls[0][0]).toBe("posts");
    expect(mocks.find.mock.calls[0][1].limit).toBe(1);
  });
  it("excludes changed lifecycle, site and member-only audience without identities or values", async () => {
    mocks.config.mockReturnValue({
      community: { audience: true },
      seo: { urlPath: (doc: Record<string, unknown>) => `/${String(doc.slug)}` },
    });
    mocks.find.mockResolvedValue({
      docs: [
        document("private", { visibility: "private", audience: "public" }),
        document("other-site", { siteId: "other", audience: "public" }),
        document("draft", { status: "draft", audience: "public" }),
        document("members", { audience: "members" }),
        document("public", { audience: "public" }),
      ],
      totalDocs: 5,
      hasNextPage: false,
    });
    const result = await install().inventory(context);
    expect(result).toEqual({
      siteId: "default",
      complete: false,
      routes: [
        { path: "/", updatedAt: null },
        { path: "/public", updatedAt: "2025-01-01T00:00:00.000Z" },
      ],
    });
    expect(mocks.find.mock.calls[0][1].where.audience).toBe("public");
    expect(JSON.stringify(result)).not.toContain("unexposed");
  });
  it("keeps unsupported/query routes unknown and conflicting ages unavailable", async () => {
    mocks.find.mockResolvedValue({
      docs: [
        document("library"),
        document("unsafe?query"),
        document("library", { updatedAt: new Date() }),
      ],
      totalDocs: 3,
      hasNextPage: false,
    });
    expect(await install().inventory(context)).toEqual({
      siteId: "default",
      complete: false,
      routes: [
        { path: "/", updatedAt: null },
        { path: "/library", updatedAt: null },
      ],
    });
    expect(() => install({ fixedRoutes: [{ loc: "https://external.test" }] })).toThrow();
    expect(() => install({ fixedRoutes: [{ loc: "/search?q=anything" }] })).toThrow();
    expect(() => install({ documentLimit: 2001 })).toThrow();
  });
});

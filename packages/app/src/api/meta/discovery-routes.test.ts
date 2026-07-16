import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BlocksModule from "@nexpress/blocks";
import type * as CoreModule from "@nexpress/core";
import {
  npRequireBlockDiscoveryResponse,
  npRequireCollectionDiscoveryResponse,
  npRequirePluginDiscoveryResponse,
  type NpPluginDiscoveryItem,
} from "@nexpress/core/discovery";

const emptyProvides = {
  blocks: [],
  patterns: [],
  templates: [],
  translations: [],
  collections: [],
  adminExtensions: [],
  actions: [],
  apiRoutes: [],
  pageRoutes: [],
  scheduledTasks: [],
  hooks: [],
};

const legacyPlugin: NpPluginDiscoveryItem = {
  apiVersion: null,
  legacy: true,
  id: "legacy",
  name: "Legacy",
  version: null,
  description: null,
  author: null,
  license: null,
  nexpress: null,
  capabilities: ["hooks:content"],
  allowedHosts: [],
  requires: [],
  provides: emptyProvides,
  agent: { description: "", category: null, tags: [] },
  usesTokens: [],
  styleSlots: {},
  hooks: [],
  routes: [],
  pageRoutes: [],
  scheduledTasks: [],
  actions: [],
};

const mocks = vi.hoisted(() => ({
  ensureFor: vi.fn(() => Promise.resolve()),
  getAllCollectionSlugs: vi.fn(() => ["posts"]),
  getCollectionConfig: vi.fn(() => ({
    slug: "posts",
    labels: { singular: "Post", plural: "Posts" },
    slugField: true,
    versions: { drafts: true, max: 10 },
    admin: { _themeOrigin: "magazine", description: "Stories" },
    fields: [
      { type: "date", name: "publishedAt", defaultValue: new Date("2026-07-16T00:00:00.000Z") },
    ],
  })),
  getPluginDiscoveryItems: vi.fn(() => [legacyPlugin]),
  getRegisteredBlockMetadata: vi.fn(() => [
    {
      type: "plugin.callout",
      label: "Callout",
      source: "plugin:callout",
      defaultProps: { body: "Hello" },
      propsSchema: [{ name: "body", label: "Body", type: "text", translatable: true }],
    },
  ]),
}));

vi.mock("@nexpress/core", async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  getAllCollectionSlugs: mocks.getAllCollectionSlugs,
  getCollectionConfig: mocks.getCollectionConfig,
  getPluginDiscoveryItems: mocks.getPluginDiscoveryItems,
}));
vi.mock("@nexpress/blocks", async (importOriginal) => ({
  ...(await importOriginal<typeof BlocksModule>()),
  getRegisteredBlockMetadata: mocks.getRegisteredBlockMetadata,
}));
vi.mock("../../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));

const { GET: getBlocks } = await import("./blocks/route.js");
const { GET: getCollections } = await import("./collections/route.js");
const { GET: getPlugins } = await import("./plugins/route.js");

describe("public discovery routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("boots plugins before projecting every active registered block", async () => {
    const response = await getBlocks();
    const payload = npRequireBlockDiscoveryResponse(await response.json());

    expect(mocks.ensureFor).toHaveBeenCalledWith("plugins");
    expect(payload.items).toEqual([
      expect.objectContaining({ type: "plugin.callout", source: "plugin:callout" }),
    ]);
  });

  it("projects resolved collection ownership and canonical date defaults", async () => {
    const response = await getCollections();
    const payload = npRequireCollectionDiscoveryResponse(await response.json());

    expect(mocks.ensureFor).toHaveBeenCalledWith("read");
    expect(payload.items[0]).toEqual(
      expect.objectContaining({
        slug: "posts",
        source: "theme:magazine",
        fields: [
          expect.objectContaining({
            source: "theme:magazine",
            defaultValue: "2026-07-16T00:00:00.000Z",
          }),
        ],
      }),
    );
  });

  it("returns the host-owned exact plugin discovery inventory", async () => {
    const response = await getPlugins();
    const payload = npRequirePluginDiscoveryResponse(await response.json());

    expect(mocks.ensureFor).toHaveBeenCalledWith("plugins");
    expect(payload.items).toEqual([legacyPlugin]);
  });
});

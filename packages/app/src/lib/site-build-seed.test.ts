import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAuthUser, NpCollectionConfig, NpTransaction } from "@nexpress/core";
import type * as CoreFacade from "@nexpress/core";
import type * as CollectionFacade from "@nexpress/core/collections";
import type * as CacheFacade from "@nexpress/core/cache";
import type * as BlockFacade from "@nexpress/blocks";
import type * as NextFacade from "@nexpress/next";
import { npRequireCacheInvalidationRequest } from "@nexpress/core/cache";
import { DEFAULT_THEME, npMergeThemeTokens } from "@nexpress/core/theme";
import { npRequireAgentSiteBlueprintV1 } from "@nexpress/core/agent-contract";
import vectors from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import {
  npCreateSiteBuildSeedArtifactV1,
  npRequireSiteBuildSeedArtifactV1,
  npSerializeSiteBuildSeedArtifactV1,
  npReconcileSiteBuildSeedArtifactV1,
  npMaterializeSiteBuildSeedV1,
  type NpSiteBuildSeedArtifactV1,
} from "./site-build-seed.js";

const mocks = vi.hoisted(() => ({
  theme: vi.fn(),
  activeTheme: vi.fn(),
  activate: vi.fn(),
  site: vi.fn(),
  setting: vi.fn(),
  tokens: vi.fn(),
  config: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  navigation: vi.fn(),
  db: vi.fn(),
  invalidate: vi.fn(),
  context: vi.fn(),
  definitions: vi.fn(),
  i18n: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  condition: vi.fn(),
}));
vi.mock("@nexpress/core", async (original) => ({
  ...(await original<typeof CoreFacade>()),
  getThemeById: mocks.theme,
  getActiveThemeId: mocks.activeTheme,
  setActiveThemeId: mocks.activate,
  getCurrentSiteId: mocks.site,
  getSetting: mocks.setting,
  setTheme: mocks.tokens,
  setNavigation: mocks.navigation,
}));
vi.mock("@nexpress/core/collections", async (original) => ({
  ...(await original<typeof CollectionFacade>()),
  getCollectionConfig: mocks.config,
  getDocumentById: mocks.read,
  saveDocument: mocks.save,
}));
vi.mock("@nexpress/core/db", () => ({ getDb: mocks.db }));
vi.mock("@nexpress/core/cache", async (original) => ({
  ...(await original<typeof CacheFacade>()),
  npInvalidateCache: mocks.invalidate,
}));
vi.mock("@nexpress/core/i18n", () => ({ getI18nConfig: mocks.i18n }));
vi.mock("@nexpress/blocks", async (original) => ({
  ...(await original<typeof BlockFacade>()),
  getRegisteredBlockMetadataForActiveSources: mocks.definitions,
}));
vi.mock("@nexpress/next", async (original) => ({
  ...(await original<typeof NextFacade>()),
  createSiteScopedBlockRenderContext: mocks.context,
}));

const first = "00000000-0000-4000-8000-000000000001",
  second = "00000000-0000-4000-8000-000000000002";
const theme = {
  manifest: { id: "fixture", name: "Fixture", version: "1.0.0" },
  impl: {
    tokens: { colors: { primary: "#123456" } },
    navLocations: { sidebar: { label: "Sidebar" } },
  },
};
const user: NpAuthUser = {
  id: "00000000-0000-4000-8000-000000000003",
  email: "staff@example.invalid",
  name: "Existing staff",
  role: "admin",
  tokenVersion: 0,
};
const ownerBindings = [{ package: "@nexpress/theme-fixture", value: theme }];
const configs: Record<string, NpCollectionConfig> = {
  topics: {
    slug: "topics",
    labels: { singular: "Topic", plural: "Topics" },
    fields: [
      { name: "title", type: "text", required: true, admin: { condition: mocks.condition } },
      { name: "parent", type: "relationship", relationTo: "topics" },
      { name: "blocks", type: "blocks" },
    ],
  },
};
function artifact(): NpSiteBuildSeedArtifactV1 {
  return {
    schemaVersion: "np.site-build-seed.v1",
    theme: {
      id: "fixture",
      package: "@nexpress/theme-fixture",
      tokens: { colors: { accent: "#654321" } },
    },
    seed: {
      mode: "demo-fixtures",
      documents: [
        {
          documentId: first,
          collection: "topics",
          locale: null,
          translationGroupId: null,
          dependsOnDocumentIds: [],
          data: { title: "First", parent: null, blocks: [], visibility: "public" },
          provenance: "demo",
        },
        {
          documentId: second,
          collection: "topics",
          locale: null,
          translationGroupId: null,
          dependsOnDocumentIds: [first],
          data: { title: "Second", parent: first, blocks: [], visibility: "public" },
          provenance: "demo",
        },
      ],
      media: [],
    },
    navigation: [
      { location: "header", items: [{ id: "home", type: "link", label: "Home", url: "/" }] },
    ],
  };
}
let stored = new Map<string, Record<string, unknown>>(),
  nav: unknown[] = [],
  storedTheme: unknown = null,
  activeTheme: string | null = null;
let database: { select: typeof mocks.select };
beforeEach(() => {
  vi.clearAllMocks();
  stored = new Map();
  nav = [];
  storedTheme = null;
  activeTheme = null;
  delete configs.topics.i18n;
  configs.topics.fields = [
    { name: "title", type: "text", required: true, admin: { condition: mocks.condition } },
    { name: "parent", type: "relationship", relationTo: "topics" },
    { name: "blocks", type: "blocks" },
  ];
  mocks.theme.mockReturnValue(theme);
  mocks.site.mockResolvedValue("tenant-fixture");
  mocks.i18n.mockReturnValue(null);
  mocks.activeTheme.mockImplementation(() => Promise.resolve(activeTheme));
  mocks.activate.mockImplementation((id: string) => {
    activeTheme = id;
    return Promise.resolve();
  });
  mocks.setting.mockImplementation(() => Promise.resolve(storedTheme));
  mocks.tokens.mockImplementation((value: unknown) => {
    storedTheme = structuredClone(value);
    return Promise.resolve(value);
  });
  mocks.config.mockImplementation((slug: string) => {
    if (!configs[slug]) throw new Error("Unregistered collection");
    return configs[slug];
  });
  mocks.read.mockImplementation((_collection: string, id: string) =>
    Promise.resolve(stored.get(id) ?? null),
  );
  mocks.save.mockImplementation(
    (
      _collection: string,
      _id: null,
      data: Record<string, unknown>,
      _user: NpAuthUser,
      options: { createId: string; status: string },
    ) => {
      const doc = { ...data, id: options.createId, status: options.status };
      stored.set(options.createId, doc);
      return Promise.resolve({ doc, operation: "create" });
    },
  );
  mocks.navigation.mockImplementation((_location: string, items: unknown) => {
    nav = [{ items: structuredClone(items) }];
    return Promise.resolve({});
  });
  mocks.where.mockImplementation(() => ({ limit: () => Promise.resolve(nav) }));
  mocks.select.mockImplementation(() => ({ from: () => ({ where: mocks.where }) }));
  database = { select: mocks.select };
  mocks.db.mockReturnValue(database);
  mocks.context.mockResolvedValue({
    activeSources: { themeId: "prior", pluginIds: new Set(["forum"]) },
  });
  mocks.definitions.mockReturnValue([]);
  mocks.invalidate.mockImplementation((request: unknown) => {
    npRequireCacheInvalidationRequest(request);
    return Promise.resolve({
      status: "applied",
      paths: { requested: 0, succeeded: 0, failed: 0 },
      tags: { requested: 1, succeeded: 1, failed: 0 },
      cdn: { status: "skipped", adapterKind: null },
    });
  });
});

describe("ordinary versioned site build seed owner", () => {
  it("extracts a normal artifact from the existing blueprint without a self-referencing plan/hash", () => {
    const blueprint = npRequireAgentSiteBlueprintV1(
      JSON.parse(
        vectors.structured.find((entry) => entry.purpose === "np.build-site-blueprint.v1")!
          .canonical,
      ),
    );
    const value = npCreateSiteBuildSeedArtifactV1(blueprint, {
      id: "fixture",
      package: blueprint.theme.package,
    });
    expect(value.seed).toEqual(blueprint.seed);
    expect(value.theme.tokens).toEqual(blueprint.theme.tokens);
    expect(Object.keys(value).sort()).toEqual(["navigation", "schemaVersion", "seed", "theme"]);
    expect(npSerializeSiteBuildSeedArtifactV1(value)).not.toContain('"blueprintHash"');
    expect(npSerializeSiteBuildSeedArtifactV1(value)).not.toContain('"filePlan"');
    const otherPlan = structuredClone(blueprint);
    for (const file of otherPlan.filePlan) file.contentHash = `nb1:file-sha256:${"A".repeat(43)}`;
    expect(
      npSerializeSiteBuildSeedArtifactV1(
        npCreateSiteBuildSeedArtifactV1(otherPlan, {
          id: "fixture",
          package: blueprint.theme.package,
        }),
      ),
    ).toBe(npSerializeSiteBuildSeedArtifactV1(value));
    expect(() =>
      npCreateSiteBuildSeedArtifactV1(blueprint, { id: "fixture", package: "other" }),
    ).toThrow();
  });
  it("detaches data without getters and reconciles exact selected projection bytes", () => {
    const original = artifact(),
      parsed = npRequireSiteBuildSeedArtifactV1(original);
    original.seed.documents[0].data.title = "Changed";
    expect(parsed.seed.documents[0].data.title).toBe("First");
    const fixture = {
      schemaVersion: "np.configured-build-render-fixture.v1" as const,
      theme: parsed.theme,
      documents: parsed.seed.documents,
      navigation: parsed.navigation,
      pageDocuments: [],
      frontPageId: null,
    };
    expect(() => npReconcileSiteBuildSeedArtifactV1(parsed, fixture)).not.toThrow();
    for (const altered of [
      { ...fixture, theme: { ...fixture.theme, id: "other" } },
      { ...fixture, documents: [] },
      { ...fixture, navigation: [] },
    ])
      expect(() => npReconcileSiteBuildSeedArtifactV1(parsed, altered)).toThrow();
    let called = false;
    const getter = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        called = true;
        return "np.site-build-seed.v1";
      },
    });
    expect(() => npRequireSiteBuildSeedArtifactV1(getter)).toThrow();
    expect(called).toBe(false);
    for (const value of [
      { ...parsed, blueprintHash: "claim" },
      { ...parsed, theme: { ...parsed.theme, tokens: { unknown: true } } },
      { ...parsed, navigation: [...parsed.navigation, ...parsed.navigation] },
    ])
      expect(() => npRequireSiteBuildSeedArtifactV1(value)).toThrow();
  });
  it("uses normal Core facades with allocated IDs in dependency order and is idempotent", async () => {
    const value = artifact(),
      result = await npMaterializeSiteBuildSeedV1(value, user, {
        ownerBindings,
        status: "published",
      });
    expect(result.documents).toEqual({ created: [first, second], unchanged: [] });
    expect(result.transaction).toBe("individual-facade-commits");
    expect(mocks.save.mock.calls.map((call) => call[4].createId)).toEqual([first, second]);
    expect(mocks.save).toHaveBeenNthCalledWith(
      1,
      "topics",
      null,
      value.seed.documents[0].data,
      user,
      { createId: first, status: "published", tx: undefined },
    );
    expect(mocks.activate).toHaveBeenCalledWith("fixture", user.id, { tx: undefined });
    expect(mocks.tokens).toHaveBeenCalledWith(
      npMergeThemeTokens(DEFAULT_THEME, theme.impl.tokens, value.theme.tokens),
      user,
      { tx: undefined },
    );
    expect(mocks.navigation).toHaveBeenCalledWith("header", value.navigation[0].items, user, {
      tx: undefined,
    });
    expect(mocks.definitions).toHaveBeenCalledWith({
      themeId: "fixture",
      pluginIds: new Set(["forum"]),
    });
    expect(mocks.condition).not.toHaveBeenCalled();
    expect(result.cacheInvalidations).toHaveLength(2);
    expect(result.pendingCacheInvalidations).toEqual([]);
    for (const owner of [
      mocks.save,
      mocks.activate,
      mocks.tokens,
      mocks.navigation,
      mocks.invalidate,
    ])
      owner.mockClear();
    const repeated = await npMaterializeSiteBuildSeedV1(value, user, {
      ownerBindings,
      status: "published",
    });
    expect(repeated.documents).toEqual({ created: [], unchanged: [first, second] });
    expect(repeated.theme).toBe("unchanged");
    expect(repeated.navigation.unchanged).toEqual(["header"]);
    for (const owner of [
      mocks.save,
      mocks.activate,
      mocks.tokens,
      mocks.navigation,
      mocks.invalidate,
    ])
      expect(owner).not.toHaveBeenCalled();
  });
  it("threads an existing outer transaction and returns only post-commit cache intents", async () => {
    // Transport fixture only: this is not PostgreSQL rollback/isolation evidence.
    const tx = database as unknown as NpTransaction;
    const result = await npMaterializeSiteBuildSeedV1(artifact(), user, {
      ownerBindings,
      status: "draft",
      tx,
    });
    expect(result.transaction).toBe("caller-owned");
    expect(result.pendingCacheInvalidations).toHaveLength(2);
    for (const request of result.pendingCacheInvalidations)
      expect(npRequireCacheInvalidationRequest(request)).toBe(request);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls.every((call) => call[4].tx === tx)).toBe(true);
    expect(mocks.tokens.mock.calls[0][2].tx).toBe(tx);
    expect(mocks.navigation.mock.calls[0][3].tx).toBe(tx);
    expect(mocks.activeTheme).toHaveBeenCalledWith({ tx });
  });
  it("preserves explicit locale IDs and compares normal date normalization on repeat", async () => {
    const value = artifact();
    configs.topics.i18n = true;
    configs.topics.fields.push({ name: "meetingAt", type: "date" });
    mocks.i18n.mockReturnValue({ locales: ["ko"], defaultLocale: "ko" });
    for (const document of value.seed.documents) {
      document.locale = "ko";
      document.translationGroupId = document.documentId;
    }
    value.seed.documents[0].data.meetingAt = "2026-10-23";
    mocks.save.mockImplementationOnce(
      (
        _collection: string,
        _id: null,
        data: Record<string, unknown>,
        _user: NpAuthUser,
        options: { createId: string; status: string },
      ) => {
        const doc = {
          ...data,
          id: options.createId,
          status: options.status,
          meetingAt: new Date(String(data.meetingAt)),
        };
        stored.set(options.createId, doc);
        return Promise.resolve({ doc, operation: "create" });
      },
    );
    await npMaterializeSiteBuildSeedV1(value, user, { ownerBindings, status: "published" });
    expect(mocks.save.mock.calls[0][2]).toMatchObject({ locale: "ko", translationGroupId: first });
    mocks.save.mockClear();
    const repeated = await npMaterializeSiteBuildSeedV1(value, user, {
      ownerBindings,
      status: "published",
    });
    expect(repeated.documents.unchanged).toEqual([first, second]);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([
    "document",
    "navigation",
    "active-theme",
    "tokens",
    "owner-identity",
    "owner-ambiguous",
  ])("preserves a conflicting %s before any write", async (kind) => {
    const value = artifact();
    if (kind === "document")
      stored.set(first, {
        ...value.seed.documents[0].data,
        id: first,
        status: "published",
        title: "Operator edited",
      });
    if (kind === "navigation")
      nav = [{ items: [{ id: "operator", type: "link", label: "Operator", url: "/operator" }] }];
    if (kind === "active-theme") activeTheme = "other";
    if (kind === "tokens") storedTheme = { colors: { primary: "#abcdef" } };
    const bindings =
      kind === "owner-identity"
        ? [{ package: ownerBindings[0].package, value: structuredClone(theme) }]
        : kind === "owner-ambiguous"
          ? [...ownerBindings, { package: "@nexpress/other-theme", value: theme }]
          : ownerBindings;
    await expect(
      npMaterializeSiteBuildSeedV1(value, user, { ownerBindings: bindings, status: "published" }),
    ).rejects.toThrow();
    for (const owner of [
      mocks.save,
      mocks.activate,
      mocks.tokens,
      mocks.navigation,
      mocks.invalidate,
    ])
      expect(owner).not.toHaveBeenCalled();
    if (kind === "document") expect(stored.get(first)?.title).toBe("Operator edited");
  });
  it.each([
    "metadata",
    "dependency",
    "schema",
    "default",
    "navigation-reference",
    "navigation-location",
    "locale",
    "block",
  ])("preflights %s failures before writes", async (kind) => {
    const value = artifact();
    if (kind === "metadata") value.seed.documents[0].data.siteId = "other";
    if (kind === "dependency") value.seed.documents[1].dependsOnDocumentIds = [];
    if (kind === "schema") value.seed.documents[0].data.title = 42;
    if (kind === "default")
      configs.topics.fields.push({ name: "implicit", type: "text", defaultValue: "default" });
    if (kind === "navigation-reference")
      value.navigation[0].items = [
        {
          type: "page",
          id: "missing",
          label: "Missing",
          pageId: "00000000-0000-4000-8000-000000000099",
        },
      ];
    if (kind === "navigation-location") value.navigation[0].location = "unregistered";
    if (kind === "locale") {
      configs.topics.i18n = true;
      value.seed.documents[0].locale = "ko";
      value.seed.documents[0].translationGroupId = first;
    }
    if (kind === "block")
      value.seed.documents[0].data.blocks = [{ id: "b", type: "unknown", props: {} }];
    await expect(
      npMaterializeSiteBuildSeedV1(value, user, { ownerBindings, status: "published" }),
    ).rejects.toThrow();
    for (const owner of [mocks.save, mocks.activate, mocks.tokens, mocks.navigation])
      expect(owner).not.toHaveBeenCalled();
  });
  it("rejects staged media before touching live facades and retains unfetched references", async () => {
    const value = artifact();
    value.seed.media = [
      {
        mediaId: "00000000-0000-4000-8000-000000000004",
        kind: "operator-supplied",
        materialization: "staged",
        sourceArtifactId: "input",
        stagedArtifactPath: ".nexpress/site/media/input.png",
        contentHash: `nb1:file-sha256:${"A".repeat(43)}`,
        mimeType: "image/png",
        byteSize: 1,
        rightsConfirmedBy: "operator",
        provenanceNote: "Operator supplied fixture.",
        alt: "Fixture",
      },
    ];
    await expect(
      npMaterializeSiteBuildSeedV1(value, user, { ownerBindings, status: "published" }),
    ).rejects.toThrow("Invalid site build seed");
    expect(mocks.theme).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
    value.seed.media = [
      {
        mediaId: "00000000-0000-4000-8000-000000000004",
        kind: "placeholder",
        materialization: "reference-only",
        placeholderId: "fixture",
        provenanceNote: "Labelled placeholder only.",
        alt: "Placeholder",
      },
    ];
    const result = await npMaterializeSiteBuildSeedV1(value, user, {
      ownerBindings,
      status: "published",
    });
    expect(result.media).toEqual({
      staged: "unsupported-allocated-id-owner-required",
      referenceOnlyRetained: [value.seed.media[0].mediaId],
      fetched: 0,
      uploaded: 0,
    });
    expect(npRequireSiteBuildSeedArtifactV1(value).seed.media).toEqual(value.seed.media);
  });
  it("keeps normal ACL failures and post-save transformations visible without overwriting existing content", async () => {
    await expect(
      npMaterializeSiteBuildSeedV1(
        artifact(),
        { ...user, role: "editor" },
        { ownerBindings, status: "published" },
      ),
    ).rejects.toThrow();
    expect(mocks.activate).not.toHaveBeenCalled();
    mocks.save.mockRejectedValueOnce(new Error("normal collection ACL denied"));
    await expect(
      npMaterializeSiteBuildSeedV1(artifact(), user, { ownerBindings, status: "published" }),
    ).rejects.toThrow("normal collection ACL denied");
    expect(mocks.navigation).not.toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    mocks.save.mockResolvedValueOnce({
      doc: {
        ...artifact().seed.documents[0].data,
        id: first,
        status: "published",
        title: "Hook transformed",
      },
      operation: "create",
    });
    await expect(
      npMaterializeSiteBuildSeedV1(artifact(), user, { ownerBindings, status: "published" }),
    ).rejects.toThrow("Normal save hooks changed");
  });
});

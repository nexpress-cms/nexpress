import { describe, expect, it } from "vitest";
import type { NpFieldConfig } from "../config/types.js";
import type { NpContentTransferDocumentEntry } from "./types.js";

import {
  NpContentTransferContractError,
  npAnalyzeContentTransferEnvelope,
  npRequireContentTransferCollectionFilter,
  npRequireContentTransferDryRun,
  npRequireContentTransferEnvelope,
  npRequireContentTransferImportReport,
} from "./contract.js";
import {
  npCollectContentTransferMediaReferences,
  npCollectContentTransferRelationshipReferences,
  npRemapContentTransferMediaReferences,
} from "./media.js";
import { npContentTransferDocumentKey, npOrderContentTransferDocumentEntries } from "./plan.js";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const RELATION_ID = "33333333-3333-4333-8333-333333333333";

function fullTransfer() {
  return {
    version: "3",
    exportedAt: "2026-07-17T00:00:00.000Z",
    siteUrl: "https://example.com",
    partial: false,
    collectionsExported: ["posts"],
    site: {
      name: "Example",
      url: "https://example.com",
      description: null,
      defaultLocale: "en",
      timezone: "UTC",
    },
    theme: null,
    settings: { activeTheme: "default" },
    navigation: { main: [] },
    collections: { posts: [{ id: RELATION_ID, title: "Hello" }] },
    media: [
      {
        id: MEDIA_ID,
        filename: "hero.png",
        hash: "a".repeat(64),
        mimeType: "image/png",
      },
    ],
    plugins: [],
  };
}

describe("content transfer envelope contract", () => {
  it("accepts and clones an exact canonical full transfer", () => {
    const source = fullTransfer();
    const parsed = npRequireContentTransferEnvelope(source);

    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
  });

  it("accepts a closed partial transfer without full-site sections", () => {
    expect(
      npRequireContentTransferEnvelope({
        version: "3",
        exportedAt: "2026-07-17T00:00:00.000Z",
        siteUrl: null,
        partial: true,
        collectionsExported: ["posts"],
        collections: { posts: [] },
        media: [],
      }),
    ).toMatchObject({ partial: true, collectionsExported: ["posts"] });
  });

  it("rejects version drift, unknown fields, and mismatched inventories", () => {
    expect(npAnalyzeContentTransferEnvelope({ ...fullTransfer(), version: "2" }).ok).toBe(false);
    expect(npAnalyzeContentTransferEnvelope({ ...fullTransfer(), extra: true }).ok).toBe(false);
    expect(
      npAnalyzeContentTransferEnvelope({ ...fullTransfer(), collectionsExported: [] }).issues,
    ).toContainEqual(expect.objectContaining({ code: "invariant" }));
    expect(
      npAnalyzeContentTransferEnvelope({ ...fullTransfer(), siteUrl: "https://other.example" })
        .issues,
    ).toContainEqual(expect.objectContaining({ path: "transfer.siteUrl", code: "invariant" }));
  });

  it("analyzes malformed nested full-site values without throwing", () => {
    expect(() => npAnalyzeContentTransferEnvelope({ ...fullTransfer(), site: null })).not.toThrow();
    expect(
      npAnalyzeContentTransferEnvelope({ ...fullTransfer(), site: null }).issues,
    ).toContainEqual(expect.objectContaining({ path: "transfer.site" }));
    expect(
      npAnalyzeContentTransferEnvelope({
        ...fullTransfer(),
        theme: { colors: { unsupported: "#fff" } },
      }).issues,
    ).toContainEqual(expect.objectContaining({ path: "transfer.theme.colors.unsupported" }));
  });

  it("requires canonical unique document ids in deterministic order", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    expect(
      npAnalyzeContentTransferEnvelope({
        ...fullTransfer(),
        collections: { posts: [{ id: second }, { id: first }] },
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: "invariant" }));
    expect(
      npAnalyzeContentTransferEnvelope({
        ...fullTransfer(),
        collections: { posts: [{ id: first }, { id: first }] },
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: "duplicate" }));
    expect(
      npAnalyzeContentTransferEnvelope({
        ...fullTransfer(),
        collections: { posts: [{ id: "legacy-id" }] },
      }).ok,
    ).toBe(false);
  });

  it("uses the canonical media filename and MIME bounds", () => {
    const malformed = fullTransfer();
    malformed.media[0] = { ...malformed.media[0], filename: " hero.png\n" };
    expect(npAnalyzeContentTransferEnvelope(malformed).ok).toBe(false);
  });

  it("requires canonical plugin manifest versions", () => {
    expect(
      npAnalyzeContentTransferEnvelope({
        ...fullTransfer(),
        plugins: [{ id: "demo", enabled: true, config: {}, manifestVersion: "not-semver" }],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeContentTransferEnvelope({
        ...fullTransfer(),
        plugins: [{ id: "demo", enabled: true, config: {}, manifestVersion: "1.2.3-beta.1+7" }],
      }).ok,
    ).toBe(true);
  });

  it("does not execute accessors and contains revoked proxies", () => {
    let getterCalled = false;
    const accessor = fullTransfer();
    Object.defineProperty(accessor, "siteUrl", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "https://example.com";
      },
    });

    expect(() => npRequireContentTransferEnvelope(accessor)).toThrow(
      NpContentTransferContractError,
    );
    expect(getterCalled).toBe(false);

    const { proxy, revoke } = Proxy.revocable(fullTransfer(), {});
    revoke();
    expect(() => npRequireContentTransferEnvelope(proxy)).toThrow(NpContentTransferContractError);
  });

  it("validates exact reports and canonical query values", () => {
    expect(
      npRequireContentTransferImportReport({
        imported: {
          site: 1,
          theme: 1,
          settings: 1,
          navigation: 1,
          documentsCreated: 2,
          documentsUpdated: 0,
          mediaMatched: 1,
          pluginsUpdated: 0,
        },
        warnings: [],
        dryRun: true,
        partial: false,
      }),
    ).toMatchObject({ dryRun: true });
    expect(npRequireContentTransferCollectionFilter("posts,pages")).toEqual(["posts", "pages"]);
    expect(npRequireContentTransferCollectionFilter("a".repeat(96))).toEqual(["a".repeat(96)]);
    expect(() => npRequireContentTransferCollectionFilter("a".repeat(97))).toThrow(
      NpContentTransferContractError,
    );
    expect(() => npRequireContentTransferCollectionFilter("posts, posts")).toThrow(
      NpContentTransferContractError,
    );
    expect(npRequireContentTransferDryRun("true")).toBe(true);
    expect(npRequireContentTransferDryRun("false")).toBe(false);
    expect(() => npRequireContentTransferDryRun("1")).toThrow(NpContentTransferContractError);
    expect(() =>
      npRequireContentTransferImportReport({
        imported: {
          site: 1,
          theme: 1,
          settings: 0,
          navigation: 0,
          documentsCreated: 0,
          documentsUpdated: 0,
          mediaMatched: 0,
          pluginsUpdated: 0,
        },
        warnings: [],
        dryRun: false,
        partial: true,
      }),
    ).toThrow(NpContentTransferContractError);
  });
});

describe("definition-aware transfer references", () => {
  const richText = {
    version: 1,
    document: {
      root: {
        type: "root",
        children: [
          {
            type: "image",
            version: 1,
            mediaId: MEDIA_ID,
          },
        ],
        direction: null,
        format: "",
        indent: 0,
        version: 1,
      },
    },
  };
  const fields: NpFieldConfig[] = [
    { type: "text", name: "title" },
    { type: "upload", name: "hero", relationTo: "media" },
    { type: "relationship", name: "category", relationTo: "categories" },
    { type: "richText", name: "body" },
    {
      type: "group",
      name: "meta",
      fields: [{ type: "upload", name: "card", relationTo: "media" }],
    },
    {
      type: "array",
      name: "gallery",
      fields: [{ type: "upload", name: "image", relationTo: "media" }],
    },
    { type: "blocks", name: "blocks" },
  ];
  const document = {
    title: MEDIA_ID,
    hero: MEDIA_ID,
    category: RELATION_ID,
    body: richText,
    meta: { card: MEDIA_ID },
    gallery: [{ image: MEDIA_ID }],
    blocks: [{ id: "block-1", type: "lookup", props: { documentId: MEDIA_ID } }],
  };

  it("collects only schema-owned media and relationship references", () => {
    expect(
      npCollectContentTransferMediaReferences(fields, document).map((ref) => ref.path),
    ).toEqual([
      "document.hero",
      "document.body.document.root.children[0].mediaId",
      "document.meta.card",
      "document.gallery[0].image",
    ]);
    expect(npCollectContentTransferRelationshipReferences(fields, document)).toEqual([
      { collection: "categories", documentId: RELATION_ID, path: "document.category" },
    ]);
  });

  it("remaps media without corrupting equal text, relationships, or block props", () => {
    const remapped = npRemapContentTransferMediaReferences(
      fields,
      document,
      new Map([[MEDIA_ID, TARGET_MEDIA_ID]]),
    );

    expect(remapped).toMatchObject({
      title: MEDIA_ID,
      hero: TARGET_MEDIA_ID,
      category: RELATION_ID,
      meta: { card: TARGET_MEDIA_ID },
      gallery: [{ image: TARGET_MEDIA_ID }],
      blocks: [{ props: { documentId: MEDIA_ID } }],
    });
    expect(
      ((remapped.body as typeof richText).document.root.children[0] as Record<string, unknown>)
        .mediaId,
    ).toBe(TARGET_MEDIA_ID);
    expect(document.hero).toBe(MEDIA_ID);
  });
});

describe("content transfer document planning", () => {
  const relationshipFields: NpFieldConfig[] = [
    { type: "relationship", name: "category", relationTo: "categories" },
  ];
  const categoryId = "44444444-4444-4444-8444-444444444444";
  const postId = "55555555-5555-4555-8555-555555555555";

  it("orders new relationship targets before their sources", () => {
    const entries: NpContentTransferDocumentEntry[] = [
      {
        collection: "posts",
        documentId: postId,
        document: { id: postId, category: categoryId },
        fields: relationshipFields,
      },
      {
        collection: "categories",
        documentId: categoryId,
        document: { id: categoryId },
        fields: [],
      },
    ];

    expect(npOrderContentTransferDocumentEntries(entries).map((entry) => entry.collection)).toEqual(
      ["categories", "posts"],
    );
    expect(
      npOrderContentTransferDocumentEntries(
        [
          {
            collection: "categories",
            documentId: categoryId,
            document: { id: categoryId, category: categoryId },
            fields: relationshipFields,
          },
        ],
        new Set([npContentTransferDocumentKey("categories", categoryId)]),
      ),
    ).toHaveLength(1);
  });

  it("rejects duplicate identities and new relationship cycles", () => {
    const self = {
      collection: "categories",
      documentId: categoryId,
      document: { id: categoryId, category: categoryId },
      fields: relationshipFields,
    };

    expect(() => npOrderContentTransferDocumentEntries([self, self])).toThrow(
      NpContentTransferContractError,
    );
    expect(() => npOrderContentTransferDocumentEntries([self])).toThrow(/relationship cycle/u);
    expect(() => npContentTransferDocumentKey("Bad collection", categoryId)).toThrow(
      NpContentTransferContractError,
    );
  });

  it("keeps a large independent plan in canonical order", () => {
    const entries = Array.from({ length: 2_000 }, (_, index) => {
      const documentId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
      return {
        collection: "posts",
        documentId,
        document: { id: documentId },
        fields: [],
      } satisfies NpContentTransferDocumentEntry;
    }).reverse();

    const ordered = npOrderContentTransferDocumentEntries(entries);
    expect(ordered[0]?.documentId).toBe("00000000-0000-4000-8000-000000000000");
    expect(ordered.at(-1)?.documentId).toBe("00000000-0000-4000-8000-0000000007cf");
  });
});

import {
  findDocuments,
  invalidatePluginEnabled,
  isPluginEnabled,
  npMedia,
  npMediaRefs,
  npNavigation,
  npPlugins,
  npSettings,
  npSitePlugins,
  npSites,
  type NpContentTransferEnvelope,
} from "@nexpress/core";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as exportGET } from "@/app/api/export/route";
import { POST as importPOST } from "@/app/api/import/route";
import { GET as openApiGET } from "@/app/api/openapi.json/route";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

function postWire(title: string, slug: string, id = POST_ID): Record<string, unknown> {
  return {
    id,
    status: "draft",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    visibility: "public",
    siteId: "default",
    slug,
    kind: "article",
    title,
    excerpt: null,
    content: npCreateEmptyRichTextContent(),
    coverImage: null,
    publishedAt: null,
    author: null,
    wpOriginalAuthor: null,
    categories: [],
    tags: [],
    parent: null,
    order: null,
    seoMetaTitle: null,
    seoMetaDescription: null,
    seoOgImage: null,
    seedSource: null,
    featured: null,
    authorName: null,
    readingTime: null,
    heroImage: null,
    client: null,
    year: null,
    role: null,
    discipline: null,
    span: null,
    coverVariant: null,
    coverFigure: null,
    badge: null,
    lede: null,
    stableSince: null,
  };
}

function categoryWire(name: string, slug: string): Record<string, unknown> {
  return {
    id: CATEGORY_ID,
    status: "draft",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    visibility: "public",
    siteId: "default",
    slug,
    name,
    description: null,
  };
}

async function exportPayload(
  session: TestUserSession,
  collections?: string,
): Promise<NpContentTransferEnvelope> {
  const response = await exportGET(
    buildRequest("/api/export", {
      session,
      ...(collections ? { query: { collections } } : {}),
    }),
  );
  const { status, body } = await readJson<NpContentTransferEnvelope>(response);
  expect(status).toBe(200);
  return body;
}

describe.skipIf(skipIfNoTestDb())("import/export API (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("exports the exact full v3 envelope", async () => {
    const session = await seedUser({ role: "admin" });
    const body = await exportPayload(session);

    expect(body).toMatchObject({
      version: "3",
      partial: false,
      siteUrl: null,
      site: { name: "Default site", url: null },
    });
    expect(body.collectionsExported).toEqual([...body.collectionsExported].sort());
    expect(body.collectionsExported).toEqual(Object.keys(body.collections));
    expect(body.media).toEqual([]);
  });

  it("exports a closed partial envelope for an exact collection filter", async () => {
    const session = await seedUser({ role: "admin" });
    const body = await exportPayload(session, "posts");

    expect(body).toMatchObject({
      version: "3",
      partial: true,
      collectionsExported: ["posts"],
      media: [],
    });
    expect(body).not.toHaveProperty("site");
    expect(body).not.toHaveProperty("plugins");
  });

  it("derives media from exported documents instead of the global reference table", async () => {
    const session = await seedUser({ role: "admin" });
    const db = await getTestDb();
    const mediaId = "22222222-2222-4222-8222-222222222222";
    await db.insert(npMedia).values({
      id: mediaId,
      filename: "other-site.png",
      originalFilename: "other-site.png",
      mimeType: "image/png",
      filesize: 1,
      storageKey: "other-site.png",
      hash: "a".repeat(64),
      status: "ready",
    });
    await db.insert(npMediaRefs).values({
      mediaId,
      collection: "posts",
      documentId: "99999999-9999-4999-8999-999999999999",
      field: "coverImage",
    });

    expect((await exportPayload(session)).media).toEqual([]);
  });

  it("rejects unknown, repeated, and unsupported export query values", async () => {
    const session = await seedUser({ role: "admin" });
    for (const path of [
      "/api/export?collections=nonexistent",
      "/api/export?collections=posts&collections=posts",
      "/api/export?dryRun=true",
    ]) {
      expect((await exportGET(buildRequest(path, { session }))).status).toBe(400);
    }
  });

  it("requires admin.manage for export", async () => {
    const session = await seedUser({ role: "editor" });
    expect((await exportGET(buildRequest("/api/export", { session }))).status).toBe(403);
  });

  it("dry-runs the same preflight and reports exact create counts without writing", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session);
    payload.collections.posts = [postWire("Imported", "imported")];

    const response = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { dryRun: "true" },
        body: payload,
      }),
    );
    const { status, body } = await readJson<{
      dryRun: boolean;
      imported: { site: number; documentsCreated: number; documentsUpdated: number };
    }>(response);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      dryRun: true,
      imported: { site: 1, documentsCreated: 1, documentsUpdated: 0 },
    });
    expect((await findDocuments("posts", { limit: 10 })).totalDocs).toBe(0);
  });

  it("preserves document ids and turns a repeated import into an update", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session, "posts");
    payload.collections.posts = [postWire("First", "portable")];

    const first = await importPOST(
      buildRequest("/api/import", { method: "POST", session, body: payload }),
    );
    expect(await first.json()).toMatchObject({
      imported: { documentsCreated: 1, documentsUpdated: 0 },
    });
    payload.collections.posts = [postWire("Second", "portable")];
    const second = await importPOST(
      buildRequest("/api/import", { method: "POST", session, body: payload }),
    );
    expect(await second.json()).toMatchObject({
      imported: { documentsCreated: 0, documentsUpdated: 1 },
    });

    const documents = await findDocuments("posts", { limit: 10 });
    expect(documents.totalDocs).toBe(1);
    expect(documents.docs[0]).toMatchObject({ id: POST_ID, title: "Second" });
  });

  it("creates new relationship targets before documents that reference them", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session, "categories,posts");
    payload.collections.categories = [categoryWire("Portable", "portable")];
    payload.collections.posts = [{ ...postWire("Related", "related"), categories: [CATEGORY_ID] }];

    const response = await importPOST(
      buildRequest("/api/import", { method: "POST", session, body: payload }),
    );
    expect(response.status).toBe(200);
    expect((await findDocuments("posts", { limit: 10 })).docs[0]).toMatchObject({
      id: POST_ID,
      categories: [CATEGORY_ID],
    });
  });

  it("rolls back the whole document batch when a later save fails", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session, "posts");
    payload.collections.posts = [
      postWire("First", "duplicate-slug", POST_ID),
      postWire("Second", "duplicate-slug", CATEGORY_ID),
    ];

    const response = await importPOST(
      buildRequest("/api/import", { method: "POST", session, body: payload }),
    );
    expect(response.status).not.toBe(200);
    expect((await findDocuments("posts", { limit: 10 })).totalDocs).toBe(0);
  });

  it("fails preflight when media hash matching is ambiguous", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session, "posts");
    const sourceMediaId = "33333333-3333-4333-8333-333333333333";
    payload.collections.posts = [
      { ...postWire("Ambiguous media", "ambiguous-media"), coverImage: sourceMediaId },
    ];
    payload.media = [
      {
        id: sourceMediaId,
        filename: "shared.png",
        hash: "b".repeat(64),
        mimeType: "image/png",
      },
    ];
    const db = await getTestDb();
    for (const [id, storageKey] of [
      ["44444444-4444-4444-8444-444444444444", "one.png"],
      ["55555555-5555-4555-8555-555555555555", "two.png"],
    ] as const) {
      await db.insert(npMedia).values({
        id,
        filename: "shared.png",
        originalFilename: "shared.png",
        mimeType: "image/png",
        filesize: 1,
        storageKey,
        hash: "b".repeat(64),
        status: "ready",
      });
    }

    const response = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { dryRun: "true" },
        body: payload,
      }),
    );
    expect(response.status).toBe(400);
    expect((await findDocuments("posts", { limit: 10 })).totalDocs).toBe(0);
  });

  it("fails preflight when a framework user relationship is missing", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session, "posts");
    payload.collections.posts = [
      {
        ...postWire("Missing author", "missing-author"),
        author: "66666666-6666-4666-8666-666666666666",
      },
    ];

    const response = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { dryRun: "true" },
        body: payload,
      }),
    );
    expect(response.status).toBe(400);
    expect((await findDocuments("posts", { limit: 10 })).totalDocs).toBe(0);
  });

  it("uses a collection query as an explicit content-only projection", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session);
    payload.collections.posts = [postWire("Projected", "projected")];

    const response = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { collections: "posts", dryRun: "true" },
        body: payload,
      }),
    );
    const { status, body } = await readJson<{
      partial: boolean;
      warnings: string[];
      imported: { site: number; theme: number; documentsCreated: number };
    }>(response);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      partial: true,
      imported: { site: 0, theme: 0, documentsCreated: 1 },
    });
    expect(body.warnings).toContainEqual(expect.stringMatching(/content only/u));
  });

  it("rejects malformed or incomplete envelopes before writes", async () => {
    const session = await seedUser({ role: "admin" });
    const valid = await exportPayload(session);
    for (const body of [
      { ...valid, version: "2" },
      { ...valid, extra: true },
      { ...valid, collectionsExported: [] },
      {
        ...valid,
        collectionsExported: [...valid.collectionsExported, "unknown"].sort(),
        collections: { ...valid.collections, unknown: [] },
      },
      { version: "3" },
    ]) {
      const response = await importPOST(
        buildRequest("/api/import", {
          method: "POST",
          session,
          query: { dryRun: "true" },
          body,
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("preflights collection definitions before changing full-site state", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session);
    if (payload.partial) throw new Error("expected full payload");
    payload.site = { ...payload.site, name: "Must not persist" };
    payload.collections.posts = [{ ...postWire("Invalid", "invalid"), title: 42 }];

    const response = await importPOST(
      buildRequest("/api/import", { method: "POST", session, body: payload }),
    );
    expect(response.status).toBe(400);
    const [site] = await (await getTestDb()).select({ name: npSites.name }).from(npSites);
    expect(site?.name).toBe("Default site");
  });

  it("preflights loaded plugin ownership before changing the target site", async () => {
    const session = await seedUser({ role: "admin" });
    const payload = await exportPayload(session);
    const db = await getTestDb();
    await db.insert(npPlugins).values({ id: "not-loaded" });
    if (payload.partial) throw new Error("expected full payload");
    payload.site = { ...payload.site, name: "Must not persist" };
    payload.plugins = [
      {
        id: "not-loaded",
        enabled: false,
        config: {},
        manifestVersion: null,
      },
    ];

    const response = await importPOST(
      buildRequest("/api/import", { method: "POST", session, body: payload }),
    );
    expect(response.status).toBe(400);
    const [site] = await db.select({ name: npSites.name }).from(npSites);
    expect(site?.name).toBe("Default site");
  });

  it("invalidates the plugin enabled gate after a full import", async () => {
    const session = await seedUser({ role: "admin" });
    const db = await getTestDb();
    invalidatePluginEnabled("reading-time", "default");
    await db.insert(npPlugins).values({ id: "reading-time" });
    await db.insert(npSitePlugins).values({
      siteId: "default",
      pluginId: "reading-time",
      enabled: false,
    });
    expect(await isPluginEnabled("reading-time", "default")).toBe(false);

    const payload = await exportPayload(session);
    if (payload.partial) throw new Error("expected full payload");
    payload.plugins = payload.plugins.map((plugin) =>
      plugin.id === "reading-time" ? { ...plugin, enabled: true } : plugin,
    );

    const response = await importPOST(
      buildRequest("/api/import", { method: "POST", session, body: payload }),
    );
    expect(response.status).toBe(200);
    expect(await isPluginEnabled("reading-time", "default")).toBe(true);
    invalidatePluginEnabled("reading-time", "default");
  });

  it("fails closed on malformed stored settings and navigation during export", async () => {
    const session = await seedUser({ role: "admin" });
    const db = await getTestDb();
    await db.insert(npSettings).values({
      key: "jobs.paused",
      value: {
        paused: false,
        changedAt: "2026-07-12T00:00:00.000Z",
        changedByUserId: null,
        reason: null,
      },
    });
    expect((await exportGET(buildRequest("/api/export", { session }))).status).toBe(400);

    await truncateAll();
    const nextSession = await seedUser({ role: "admin" });
    await (await getTestDb()).insert(npNavigation).values({
      location: "header",
      items: [
        { id: "duplicate", label: "One", type: "link", url: "/" },
        { id: "duplicate", label: "Two", type: "link", url: "/two" },
      ],
    });
    expect((await exportGET(buildRequest("/api/export", { session: nextSession }))).status).toBe(
      400,
    );
  });

  it("publishes the closed v3 transfer schemas in OpenAPI", async () => {
    const { body } = await readJson<{
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    }>(await openApiGET());
    const schemas = body.components.schemas;

    expect(schemas.content_transfer_full_envelope).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: { version: { enum: ["3"] }, partial: { enum: [false] } },
    });
    expect(schemas.content_transfer_partial_envelope).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: { partial: { enum: [true] } },
    });
    expect(schemas.content_transfer_collections).toMatchObject({
      additionalProperties: false,
      properties: { posts: { items: { $ref: "#/components/schemas/posts_document" } } },
    });
    expect(body.paths["/api/import"]).toMatchObject({
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/content_transfer_envelope" },
            },
          },
        },
      },
    });
  });
});

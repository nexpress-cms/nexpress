import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { npNavigation, npPlugins, npSettings, npSites } from "@nexpress/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
} from "./harness.js";

import { GET as exportGET } from "@/app/api/export/route";
import { POST as importPOST } from "@/app/api/import/route";
import { GET as openApiGET } from "@/app/api/openapi.json/route";

function postWire(title: string, slug: string): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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

  it("export returns full payload shape and carries siteUrl/partial", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await exportGET(buildRequest("/api/export", { session }));
    const { status, body } = await readJson<{
      version: string;
      partial: boolean;
      collectionsExported: string[];
      siteUrl: string | null;
      site: { name: string; url: string | null };
      collections: Record<string, unknown[]>;
    }>(res);
    expect(status).toBe(200);
    expect(body.version).toBe("3");
    expect(body.partial).toBe(false);
    expect(body.site).toMatchObject({ name: "Default site", url: null });
    expect(Array.isArray(body.collectionsExported)).toBe(true);
    expect(body.collectionsExported).toContain("posts");
  });

  it("export with ?collections=posts marks partial and drops non-content sections", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await exportGET(
      buildRequest("/api/export", { session, query: { collections: "posts" } }),
    );
    const { status, body } = await readJson<{
      partial: boolean;
      collectionsExported: string[];
      theme?: unknown;
      plugins?: unknown;
    }>(res);
    expect(status).toBe(200);
    expect(body.partial).toBe(true);
    expect(body.collectionsExported).toEqual(["posts"]);
    // Non-content sections omitted on partial export.
    expect(body.theme).toBeUndefined();
    expect(body.plugins).toBeUndefined();
  });

  it("export with unknown collection in filter returns 422", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await exportGET(
      buildRequest("/api/export", { session, query: { collections: "nonexistent" } }),
    );
    expect(res.status).toBe(400);
  });

  it("export without admin role returns 403", async () => {
    const session = await seedUser({ role: "editor" });
    const res = await exportGET(buildRequest("/api/export", { session }));
    expect(res.status).toBe(403);
  });

  it("import ?dryRun=true reports counts without writing", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { dryRun: "true" },
        body: {
          version: "3",
          site: {
            name: "Test Site",
            url: "https://example.com",
            description: "A test site",
            defaultLocale: "en-US",
            timezone: "UTC",
          },
          settings: {
            seo: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
          },
          collections: {
            posts: [postWire("Imported", "imported")],
          },
        },
      }),
    );
    const { status, body } = await readJson<{
      dryRun: boolean;
      imported: { pages: number; settings: number };
    }>(res);
    expect(status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.imported.pages).toBe(1);
    expect(body.imported.settings).toBe(2);
  });

  it("import ?collections=posts drops non-content sections with a warning", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { collections: "posts", dryRun: "true" },
        body: {
          version: "3",
          theme: { colors: {} },
          settings: {
            seo: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
          },
          collections: {
            posts: [postWire("P", "p")],
          },
        },
      }),
    );
    const { status, body } = await readJson<{
      partial: boolean;
      warnings: string[];
      imported: { pages: number; theme: number; settings: number };
    }>(res);
    expect(status).toBe(200);
    expect(body.partial).toBe(true);
    expect(body.imported.pages).toBe(1);
    expect(body.imported.theme).toBe(0);
    expect(body.imported.settings).toBe(0);
    expect(body.warnings.some((w) => /Partial import/.test(w))).toBe(true);
  });

  it("import with unknown collection in filter returns 422", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { collections: "nonexistent" },
        body: { version: "3" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("import requires the exact v3 envelope and rejects unknown top-level fields", async () => {
    const session = await seedUser({ role: "admin" });
    for (const body of [{ collections: {} }, { version: "3", legacySettings: {} }]) {
      const res = await importPOST(
        buildRequest("/api/import", {
          method: "POST",
          session,
          query: { dryRun: "true" },
          body,
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it("import rejects invalid theme overlays even during dry-run", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { dryRun: "true" },
        body: {
          version: "3",
          theme: { colors: { primary: "url(https://example.com/x)" } },
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("import rejects duplicate owner ids and the legacy settings.theme location", async () => {
    const session = await seedUser({ role: "admin" });
    for (const body of [
      { version: "3", settings: { theme: { colors: {} } } },
      {
        version: "3",
        settings: {
          "jobs.paused": {
            paused: false,
            changedAt: "2026-07-12T00:00:00.000Z",
            changedByUserId: null,
            reason: null,
          },
        },
      },
      { version: "3", media: [{ id: "same" }, { id: "same" }] },
      { version: "3", plugins: [{ id: "same" }, { id: "same" }] },
    ]) {
      const res = await importPOST(
        buildRequest("/api/import", {
          method: "POST",
          session,
          query: { dryRun: "true" },
          body,
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it("rejects a site-scoped global setting during export", async () => {
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

    const res = await exportGET(buildRequest("/api/export", { session }));
    expect(res.status).toBe(400);
  });

  it("publishes the closed site-config settings registry in OpenAPI", async () => {
    const response = await openApiGET();
    const { body } = await readJson<{
      components: {
        schemas: {
          framework_settings: {
            additionalProperties: boolean;
            properties: Record<string, unknown>;
            patternProperties: Record<string, unknown>;
          };
        };
      };
    }>(response);
    const schema = body.components.schemas.framework_settings;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).toHaveProperty("seo");
    expect(schema.properties).not.toHaveProperty("theme");
    expect(schema.properties).not.toHaveProperty("jobs.paused");
    expect(Object.keys(schema.patternProperties)).toEqual([
      "^theme\\.settings:[a-z][a-z0-9-]{0,62}$",
    ]);
  });

  it("preflights loaded plugin ownership before changing site settings", async () => {
    const session = await seedUser({ role: "admin" });
    const db = await getTestDb();
    await db.insert(npPlugins).values({ id: "not-loaded", enabled: true });

    const res = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        body: {
          version: "3",
          site: {
            name: "Must not persist",
            url: null,
            description: null,
            defaultLocale: null,
            timezone: null,
          },
          plugins: [{ id: "not-loaded", enabled: false }],
        },
      }),
    );

    expect(res.status).toBe(400);
    const [site] = await db.select({ name: npSites.name }).from(npSites);
    expect(site?.name).toBe("Default site");
  });

  it("import rejects invalid navigation before dry-run or persistence", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { dryRun: "true" },
        body: {
          version: "3",
          navigation: {
            header: [{ id: "unsafe", label: "Unsafe", type: "link", url: "javascript:alert(1)" }],
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    const db = await getTestDb();
    expect(await db.select().from(npNavigation)).toHaveLength(0);
  });

  it("export refuses malformed stored navigation", async () => {
    const session = await seedUser({ role: "admin" });
    const db = await getTestDb();
    await db.insert(npNavigation).values({
      location: "header",
      items: [
        { id: "duplicate", label: "One", type: "link", url: "/" },
        {
          id: "duplicate",
          label: "Two",
          type: "link",
          url: "/two",
        },
      ],
    });
    const res = await exportGET(buildRequest("/api/export", { session }));
    expect(res.status).toBe(400);
  });
});

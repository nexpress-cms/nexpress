import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { npNavigation } from "@nexpress/core";
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
    expect(body.version).toBe("2");
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
          version: "2",
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
            posts: [
              {
                title: "Imported",
                slug: "imported",
                content: npCreateEmptyRichTextContent(),
                _status: "draft",
              },
            ],
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
          version: "2",
          theme: { colors: {} },
          settings: {
            seo: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
          },
          collections: {
            posts: [
              {
                title: "P",
                slug: "p",
                content: npCreateEmptyRichTextContent(),
                _status: "draft",
              },
            ],
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
        body: { version: "2" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("import requires the exact v2 envelope and rejects unknown top-level fields", async () => {
    const session = await seedUser({ role: "admin" });
    for (const body of [{ collections: {} }, { version: "2", legacySettings: {} }]) {
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
          version: "2",
          theme: { colors: { primary: "url(https://example.com/x)" } },
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("import rejects invalid navigation before dry-run or persistence", async () => {
    const session = await seedUser({ role: "admin" });
    const res = await importPOST(
      buildRequest("/api/import", {
        method: "POST",
        session,
        query: { dryRun: "true" },
        body: {
          version: "2",
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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
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
      collections: Record<string, unknown[]>;
    }>(res);
    expect(status).toBe(200);
    expect(body.version).toBe("1");
    expect(body.partial).toBe(false);
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
          version: "1",
          settings: { siteName: "Test Site", footer: "© 2026" },
          collections: {
            posts: [
              {
                title: "Imported",
                slug: "imported",
                content: { root: { type: "root", children: [] } },
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
          version: "1",
          theme: { colors: {} },
          settings: { siteName: "X" },
          collections: {
            posts: [
              {
                title: "P",
                slug: "p",
                content: { root: { type: "root", children: [] } },
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
        body: { version: "1" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

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
import type { TestUserSession } from "./harness.js";

/**
 * Phase 12.6b — translation completeness dashboard.
 *
 *   1. `getTranslationProgress()` core helper returns one
 *      entry per i18n-enabled collection with totalGroups +
 *      per-locale counts + missing deltas
 *   2. `GET /api/admin/i18n/progress` exposes the same shape;
 *      gates editor+
 */
describe.skipIf(skipIfNoTestDb())("i18n progress (Phase 12.6b)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  let admin: TestUserSession;
  beforeEach(async () => {
    admin = await seedUser({ role: "admin" });
  });

  function actor() {
    return {
      id: admin.userId,
      email: admin.email,
      name: "Test",
      role: admin.role,
      tokenVersion: 0,
    };
  }

  it("counts groups + per-locale rows for every i18n collection", async () => {
    const { getTranslationProgress, saveDocument, createTranslation } =
      await import("@nexpress/core");

    // Two source pages in EN; translate one of them to KO so
    // we end up with 2 groups, 2 EN rows, 1 KO row, 1 KO
    // missing.
    const a = await saveDocument(
      "pages",
      null,
      { title: "Alpha", seoDescription: "en", locale: "en" },
      actor(),
      { status: "published" },
    );
    await saveDocument(
      "pages",
      null,
      { title: "Beta", seoDescription: "en", locale: "en" },
      actor(),
      { status: "published" },
    );
    await createTranslation(
      "pages",
      a.doc.id as string,
      "ko",
      actor(),
    );

    const progress = await getTranslationProgress();
    expect(progress).not.toBeNull();
    expect(progress?.locales).toEqual(["en", "ko"]);

    const lp = progress?.collections.find(
      (c) => c.collection === "pages",
    );
    expect(lp).toBeDefined();
    expect(lp?.totalGroups).toBe(2);
    expect(lp?.perLocale.en).toEqual({ count: 2, missing: 0 });
    expect(lp?.perLocale.ko).toEqual({ count: 1, missing: 1 });
  });

  it("treats every locale as zero/missing when no rows exist", async () => {
    const { getTranslationProgress } = await import("@nexpress/core");
    const progress = await getTranslationProgress();
    const lp = progress?.collections.find(
      (c) => c.collection === "pages",
    );
    expect(lp?.totalGroups).toBe(0);
    expect(lp?.perLocale.en).toEqual({ count: 0, missing: 0 });
    expect(lp?.perLocale.ko).toEqual({ count: 0, missing: 0 });
  });

  it("skips non-i18n collections silently", async () => {
    const { getTranslationProgress, saveDocument } = await import(
      "@nexpress/core"
    );
    // posts is NOT i18n-enabled in the reference config; this
    // write should not influence translation progress.
    await saveDocument(
      "posts",
      null,
      {
        title: "non-i18n",
        excerpt: "x",
        content: lexical("hello"),
        publishedAt: new Date().toISOString(),
        author: admin.userId,
      },
      actor(),
      { status: "published" },
    );

    const progress = await getTranslationProgress();
    const slugs = (progress?.collections ?? []).map((c) => c.collection);
    expect(slugs).not.toContain("posts");
  });

  it("GET /api/admin/i18n/progress returns the same shape (editor+)", async () => {
    const { saveDocument } = await import("@nexpress/core");
    const editor = await seedUser({ role: "editor" });
    await saveDocument(
      "pages",
      null,
      { title: "Solo", seoDescription: "en only", locale: "en" },
      actor(),
      { status: "published" },
    );

    const { GET } = await import("@/app/api/admin/i18n/progress/route");
    const req = buildRequest("/api/admin/i18n/progress", { session: editor });
    const res = await GET(req);
    const { status, body } = await readJson<{
      defaultLocale?: string;
      collections?: Array<{
        collection: string;
        totalGroups: number;
        perLocale: Record<string, { count: number; missing: number }>;
      }>;
    }>(res);
    expect(status).toBe(200);
    expect(body.defaultLocale).toBe("en");
    const lp = body.collections?.find((c) => c.collection === "pages");
    expect(lp?.totalGroups).toBe(1);
    expect(lp?.perLocale.en.count).toBe(1);
    expect(lp?.perLocale.ko.missing).toBe(1);
  });

  it("GET /api/admin/i18n/progress rejects viewer role", async () => {
    const viewer = await seedUser({ role: "viewer" });
    const { GET } = await import("@/app/api/admin/i18n/progress/route");
    const req = buildRequest("/api/admin/i18n/progress", { session: viewer });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });
});

function lexical(text: string): unknown {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [
            {
              type: "text",
              version: 1,
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
            },
          ],
        },
      ],
    },
  };
}

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
 * Phase 12.3 — admin translation UX. Pin the `findTranslations`
 * + `createTranslation` core helpers and the
 * `/api/admin/collections/{slug}/{id}/translations` route
 * surface so the UI tabs + create-translation buttons stay
 * wired correctly through future refactors.
 */
describe.skipIf(skipIfNoTestDb())("i18n translations (Phase 12.3)", () => {
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

  it("findTranslations returns the source row alone when no siblings exist", async () => {
    const { findTranslations, saveDocument } = await import("@nexpress/core");
    const created = await saveDocument(
      "pages",
      null,
      { title: "Solo", seoDescription: "single locale", locale: "en" },
      actor(),
      { status: "published" },
    );
    const id = created.doc.id as string;
    const rows = await findTranslations("pages", id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.locale).toBe("en");
    expect(rows[0]?.translationGroupId).toBe(
      (created.doc as { translationGroupId: string }).translationGroupId,
    );
  });

  it("createTranslation copies the source content into a new locale and links via translationGroupId", async () => {
    const { createTranslation, findTranslations, saveDocument } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "About", seoDescription: "english copy", locale: "en" },
      actor(),
      { status: "published" },
    );
    const enId = en.doc.id as string;
    const created = await createTranslation("pages", enId, "ko", actor());
    expect(typeof created.id).toBe("string");

    const rows = await findTranslations("pages", enId);
    expect(rows.length).toBe(2);
    const groupIds = new Set(rows.map((r) => r.translationGroupId));
    expect(groupIds.size).toBe(1);
    const ko = rows.find((r) => r.locale === "ko");
    expect(ko?.id).toBe(created.id);
    // New translations land as draft so the translator can
    // review before publishing.
    expect(ko?.status).toBe("draft");
  });

  it("createTranslation rejects duplicates for the same target locale", async () => {
    const { createTranslation, saveDocument, NpValidationError } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "Dup", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    await createTranslation("pages", en.doc.id as string, "ko", actor());
    await expect(
      createTranslation("pages", en.doc.id as string, "ko", actor()),
    ).rejects.toBeInstanceOf(NpValidationError);
  });

  it("createTranslation rejects unknown locales", async () => {
    const { createTranslation, saveDocument, NpValidationError } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "Bogus", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    await expect(
      createTranslation("pages", en.doc.id as string, "fr", actor()),
    ).rejects.toBeInstanceOf(NpValidationError);
  });

  it("createTranslation refuses to create a translation in the source's own locale", async () => {
    const { createTranslation, saveDocument, NpValidationError } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "Self", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    await expect(
      createTranslation("pages", en.doc.id as string, "en", actor()),
    ).rejects.toBeInstanceOf(NpValidationError);
  });

  it("findTranslations rejects non-i18n collections", async () => {
    const { findTranslations, NpValidationError } = await import("@nexpress/core");
    await expect(
      findTranslations("posts", "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(NpValidationError);
  });

  it("GET /api/admin/collections/[slug]/[id]/translations returns siblings (editor+)", async () => {
    const editor = await seedUser({ role: "editor" });
    const { saveDocument } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "API test", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    const enId = en.doc.id as string;
    await saveDocument(
      "pages",
      null,
      {
        title: "API test",
        seoDescription: "...",
        locale: "ko",
        translationGroupId: (en.doc as { translationGroupId: string }).translationGroupId,
      },
      actor(),
      { status: "published" },
    );

    const { GET } = await import("@/app/api/admin/collections/[slug]/[id]/translations/route");
    const req = buildRequest(`/api/admin/collections/pages/${enId}/translations`, {
      session: editor,
    });
    const res = await GET(req, {
      params: Promise.resolve({ slug: "pages", id: enId }),
    });
    const { status, body } = await readJson<{
      docs?: Array<{ id: string; locale: string }>;
    }>(res);
    expect(status).toBe(200);
    const locales = (body.docs ?? []).map((d) => d.locale).sort();
    expect(locales).toEqual(["en", "ko"]);
  });

  it("POST /api/admin/collections/[slug]/[id]/translations creates a translation (admin-only)", async () => {
    const { saveDocument } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "Create-API", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    const enId = en.doc.id as string;

    const { POST } = await import("@/app/api/admin/collections/[slug]/[id]/translations/route");
    const req = buildRequest(`/api/admin/collections/pages/${enId}/translations`, {
      session: admin,
      method: "POST",
      body: { targetLocale: "ko" },
    });
    const res = await POST(req, {
      params: Promise.resolve({ slug: "pages", id: enId }),
    });
    const { status, body } = await readJson<{ id?: string }>(res);
    expect(status).toBe(200);
    expect(typeof body.id).toBe("string");
  });

  it("POST translations is admin-only (editors get 403)", async () => {
    const editor = await seedUser({ role: "editor" });
    const { saveDocument } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "Gate", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    const enId = en.doc.id as string;
    const { POST } = await import("@/app/api/admin/collections/[slug]/[id]/translations/route");
    const req = buildRequest(`/api/admin/collections/pages/${enId}/translations`, {
      session: editor,
      method: "POST",
      body: { targetLocale: "ko" },
    });
    const res = await POST(req, {
      params: Promise.resolve({ slug: "pages", id: enId }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("GET /api/admin/i18n returns the configured locales for editors", async () => {
    const editor = await seedUser({ role: "editor" });
    const { GET } = await import("@/app/api/admin/i18n/route");
    const req = buildRequest("/api/admin/i18n", { session: editor });
    const res = await GET(req);
    const { status, body } = await readJson<{
      enabled?: boolean;
      locales?: string[];
      defaultLocale?: string;
    }>(res);
    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.locales).toEqual(["en", "ko"]);
    expect(body.defaultLocale).toBe("en");
  });

  it("GET /api/admin/i18n forbids viewers", async () => {
    const viewer = await seedUser({ role: "viewer" });
    const { GET } = await import("@/app/api/admin/i18n/route");
    const req = buildRequest("/api/admin/i18n", { session: viewer });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });
});

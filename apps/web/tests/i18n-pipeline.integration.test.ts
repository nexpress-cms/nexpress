import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import type { TestUserSession } from "./harness.js";

/**
 * Phase 12.1 — framework i18n primitives. The pages
 * collection is opted in via `i18n: true`; codegen added the
 * `locale` + `translation_group_id` columns and re-keyed the
 * slug uniqueness on `(locale, slug)`. These tests pin the
 * pipeline behavior:
 *
 *   - locale defaults to defaultLocale on creates that omit it
 *   - locale validates against the configured locales list
 *   - the same slug can exist in two locales
 *   - translationGroupId links siblings; defaults to a new UUID
 *   - findDocuments({ locale }) filters correctly
 *   - updates can't reassign locale or translationGroupId
 */
describe.skipIf(skipIfNoTestDb())("i18n pipeline (Phase 12.1)", () => {
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

  let session: TestUserSession;

  beforeEach(async () => {
    session = await seedUser({ role: "admin" });
  });

  function actor() {
    return {
      id: session.userId,
      email: session.email,
      name: "Test",
      role: session.role,
      tokenVersion: 0,
    };
  }

  it("creates a doc with explicit locale; persists locale + a generated translation group id", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const result = await saveDocument(
      "pages",
      null,
      { title: "About", seoDescription: "About the site (en)", locale: "en" },
      actor(),
      { status: "published" },
    );
    expect(result.operation).toBe("create");
    const id = result.doc.id as string;

    const found = await findDocuments("pages", { limit: 10 });
    const row = found.docs.find((d) => d.id === id) as
      { locale?: string; translationGroupId?: string } | undefined;
    expect(row?.locale).toBe("en");
    expect(typeof row?.translationGroupId).toBe("string");
    expect(row?.translationGroupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("defaults locale to defaultLocale when omitted on create", async () => {
    const { saveDocument } = await import("@nexpress/core");
    const result = await saveDocument(
      "pages",
      null,
      { title: "Default-locale doc", seoDescription: "no locale supplied" },
      actor(),
      { status: "published" },
    );
    expect((result.doc as { locale?: string }).locale).toBe("en");
  });

  it("rejects unknown locales at write time", async () => {
    const { saveDocument, NpValidationError } = await import("@nexpress/core");
    await expect(
      saveDocument("pages", null, { title: "Bogus", seoDescription: "...", locale: "fr" }, actor()),
    ).rejects.toBeInstanceOf(NpValidationError);
  });

  it("the same slug can exist in two locales (uniqueness is per-locale)", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "About", seoDescription: "english copy", locale: "en" },
      actor(),
      { status: "published" },
    );
    const ko = await saveDocument(
      "pages",
      null,
      {
        title: "About",
        seoDescription: "korean copy",
        locale: "ko",
        // Link the two as translations of each other by sharing
        // the same translationGroupId.
        translationGroupId: (en.doc as { translationGroupId: string }).translationGroupId,
      },
      actor(),
      { status: "published" },
    );

    expect((en.doc as { slug?: string }).slug).toBe("about");
    expect((ko.doc as { slug?: string }).slug).toBe("about");
    expect((en.doc as { translationGroupId: string }).translationGroupId).toBe(
      (ko.doc as { translationGroupId: string }).translationGroupId,
    );

    const all = await findDocuments("pages", { limit: 10 });
    expect(all.totalDocs).toBe(2);
  });

  it("findDocuments({ locale }) filters to that locale's rows", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    await saveDocument(
      "pages",
      null,
      { title: "EN row", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    await saveDocument(
      "pages",
      null,
      { title: "KO row", seoDescription: "...", locale: "ko" },
      actor(),
      { status: "published" },
    );

    const enOnly = await findDocuments("pages", {
      locale: "en",
      limit: 10,
    });
    expect(enOnly.totalDocs).toBe(1);
    expect((enOnly.docs[0] as { locale?: string }).locale).toBe("en");

    const koOnly = await findDocuments("pages", {
      locale: "ko",
      limit: 10,
    });
    expect(koOnly.totalDocs).toBe(1);
    expect((koOnly.docs[0] as { locale?: string }).locale).toBe("ko");
  });

  it("updates can't reassign locale or translationGroupId", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const created = await saveDocument(
      "pages",
      null,
      { title: "Sticky", seoDescription: "first write", locale: "en" },
      actor(),
      { status: "published" },
    );
    const id = created.doc.id as string;
    const originalLocale = (created.doc as { locale: string }).locale;
    const originalGroup = (created.doc as { translationGroupId: string }).translationGroupId;

    await saveDocument(
      "pages",
      id,
      {
        title: "Sticky",
        seoDescription: "second write",
        // Caller tries to flip the locale; pipeline must ignore.
        locale: "ko",
        translationGroupId: "11111111-1111-4111-8111-111111111111",
      },
      actor(),
    );

    const found = await findDocuments("pages", { limit: 10 });
    const row = found.docs.find((d) => d.id === id) as
      { locale?: string; translationGroupId?: string } | undefined;
    expect(row?.locale).toBe(originalLocale);
    expect(row?.translationGroupId).toBe(originalGroup);
  });
});

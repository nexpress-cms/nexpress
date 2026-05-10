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
 * Phase 12.4 — i18n search + feed scoping. The cross-collection
 * search and the Atom feed both pull through `findDocuments`
 * with a `locale` filter on i18n collections. Non-i18n
 * collections silently ignore the option, so a single mixed
 * search still works.
 */
describe.skipIf(skipIfNoTestDb())("i18n search + feed (Phase 12.4)", () => {
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

  it("searchCollections({ locale }) restricts i18n collections to that locale's rows", async () => {
    const { saveDocument, searchCollections } = await import("@nexpress/core");
    // Two rows sharing a translation group — same English word
    // "tigerlily" present in both bodies. Without locale
    // scoping the search returns both; with `locale: "en"` it
    // returns just the en row.
    const en = await saveDocument(
      "pages",
      null,
      { title: "EN", seoDescription: "tigerlily english body", locale: "en" },
      actor(),
      { status: "published" },
    );
    await saveDocument(
      "pages",
      null,
      {
        title: "KO",
        seoDescription: "tigerlily korean body",
        locale: "ko",
        translationGroupId: (en.doc as { translationGroupId: string })
          .translationGroupId,
      },
      actor(),
      { status: "published" },
    );

    const all = await searchCollections({
      q: "tigerlily",
      collections: ["pages"],
    });
    expect(all.total).toBeGreaterThanOrEqual(2);

    const enOnly = await searchCollections({
      q: "tigerlily",
      collections: ["pages"],
      locale: "en",
    });
    expect(enOnly.total).toBe(1);
    expect(enOnly.results[0]?.doc.locale).toBe("en");

    const koOnly = await searchCollections({
      q: "tigerlily",
      collections: ["pages"],
      locale: "ko",
    });
    expect(koOnly.total).toBe(1);
    expect(koOnly.results[0]?.doc.locale).toBe("ko");
  });

  it("searchCollections({ locale }) leaves non-i18n collections unfiltered", async () => {
    // posts isn't i18n. A `locale: "en"` filter shouldn't
    // accidentally exclude rows from a non-i18n collection
    // (which has no `locale` column at all).
    const { saveDocument, searchCollections } = await import("@nexpress/core");
    await saveDocument(
      "posts",
      null,
      {
        title: "Manticore",
        excerpt: "manticore",
        content: lexicalParagraph("manticore body for non-i18n collection"),
        publishedAt: new Date().toISOString(),
        author: admin.userId,
      },
      actor(),
      { status: "published" },
    );

    const result = await searchCollections({
      q: "manticore",
      collections: ["posts"],
      locale: "en",
    });
    expect(result.total).toBe(1);
  });

  it("buildAtomFeed({ locale }) restricts an i18n collection's feed to one locale", async () => {
    const { saveDocument, buildAtomFeed } = await import("@nexpress/core");
    const en = await saveDocument(
      "pages",
      null,
      { title: "EN feed entry", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    await saveDocument(
      "pages",
      null,
      {
        title: "KO feed entry",
        seoDescription: "...",
        locale: "ko",
        translationGroupId: (en.doc as { translationGroupId: string })
          .translationGroupId,
      },
      actor(),
      { status: "published" },
    );

    const enFeed = await buildAtomFeed({
      collection: "pages",
      locale: "en",
    });
    expect(enFeed?.entries.map((e) => e.title)).toEqual(["EN feed entry"]);

    const koFeed = await buildAtomFeed({
      collection: "pages",
      locale: "ko",
    });
    expect(koFeed?.entries.map((e) => e.title)).toEqual(["KO feed entry"]);

    const allFeed = await buildAtomFeed({ collection: "pages" });
    expect(allFeed?.entries.length).toBe(2);
  });

  it("renderAtomFeed embeds xml:lang and locale-scoped self-link when a locale is supplied", async () => {
    const { saveDocument, renderAtomFeed } = await import("@nexpress/core");
    await saveDocument(
      "pages",
      null,
      { title: "Lang test", seoDescription: "...", locale: "ko" },
      actor(),
      { status: "published" },
    );
    const xml = await renderAtomFeed({
      collection: "pages",
      locale: "ko",
    });
    expect(xml).toContain('xml:lang="ko"');
    expect(xml).toContain("locale=ko");
  });

  it("renderAtomFeed without a locale doesn't emit xml:lang", async () => {
    const { saveDocument, renderAtomFeed } = await import("@nexpress/core");
    await saveDocument(
      "pages",
      null,
      { title: "No lang", seoDescription: "...", locale: "en" },
      actor(),
      { status: "published" },
    );
    const xml = await renderAtomFeed({ collection: "pages" });
    expect(xml).not.toContain("xml:lang");
  });
});

function lexicalParagraph(text: string): unknown {
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

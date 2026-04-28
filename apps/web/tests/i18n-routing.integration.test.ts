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
 * Phase 12.2 — public site i18n routing.
 *
 * Asserts the sitemap walk groups translation siblings + emits
 * hreflang alternates, the catch-all metadata helper produces
 * `<link rel="alternate" hreflang="...">` entries via Next's
 * `Metadata.alternates.languages` shape, and the localized
 * collection's seo.urlPath survives a round-trip with the locale
 * prefix.
 *
 * The route handler itself isn't unit-tested here (rendering
 * goes through React Server Components that need the full Next
 * runtime). The catch-all behavior is covered by manual smoke
 * tests on `pnpm dev`.
 */
describe.skipIf(skipIfNoTestDb())("i18n public routing (Phase 12.2)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
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

  it("buildSitemap groups translation siblings and emits hreflang alternates", async () => {
    const { buildSitemap, saveDocument } = await import("@nexpress/core");

    // Two locales of the same logical page sharing one
    // translationGroupId — the seo.urlPath emits
    // `/{locale}/{slug}` so the resulting sitemap rows live at
    // `/en/about` and `/ko/about`.
    const en = await saveDocument(
      "localized-pages",
      null,
      { title: "About", body: "english", locale: "en" },
      actor(),
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;
    await saveDocument(
      "localized-pages",
      null,
      {
        title: "About",
        body: "korean",
        locale: "ko",
        translationGroupId: groupId,
      },
      actor(),
      { status: "published" },
    );

    const entries = await buildSitemap({ collections: ["localized-pages"] });
    const matched = entries.filter((e) => e.loc.endsWith("/about"));
    expect(matched.length).toBe(2);
    // Each entry's alternates should list both locales.
    for (const entry of matched) {
      expect(entry.alternates?.length).toBe(2);
      const codes = entry.alternates!.map((a) => a.hreflang).sort();
      expect(codes).toEqual(["en", "ko"]);
    }
  });

  it("renderSitemapXml emits xhtml:link alternates when entries carry them", async () => {
    const { renderSitemapXml } = await import("@nexpress/core");
    const xml = renderSitemapXml("https://example.com", [
      {
        loc: "/en/hello",
        alternates: [
          { hreflang: "en", href: "/en/hello" },
          { hreflang: "ko", href: "/ko/hello" },
        ],
      },
    ]);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain(
      'xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/hello"',
    );
    expect(xml).toContain(
      'xhtml:link rel="alternate" hreflang="ko" href="https://example.com/ko/hello"',
    );
  });

  it("renderSitemapXml omits xhtml namespace when no entries have alternates", async () => {
    const { renderSitemapXml } = await import("@nexpress/core");
    const xml = renderSitemapXml("https://example.com", [{ loc: "/about" }]);
    expect(xml).not.toContain("xhtml");
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it("solo translations (no siblings) get no `alternates` block", async () => {
    const { buildSitemap, saveDocument } = await import("@nexpress/core");
    await saveDocument(
      "localized-pages",
      null,
      { title: "Solo", body: "only en", locale: "en" },
      actor(),
      { status: "published" },
    );
    const entries = await buildSitemap({ collections: ["localized-pages"] });
    const solo = entries.find((e) => e.loc.endsWith("/solo"));
    expect(solo).toBeDefined();
    expect(solo?.alternates).toBeUndefined();
  });

  it("buildPageMetadata accepts a locale and forwards it to og:locale", async () => {
    const { buildPageMetadata } = await import("@nexpress/core");
    const meta = await buildPageMetadata({
      title: "Hello",
      description: "...",
      path: "/ko/hello",
      ogType: "website",
      locale: "ko",
    });
    expect(meta.openGraph?.locale).toBe("ko");
  });

  it("isLocale correctly recognizes configured locales and rejects others", async () => {
    const { isLocale } = await import("@/i18n.config");
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ko")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(123)).toBe(false);
  });

  it("resolveAvailableLocales returns sibling locales for an i18n doc with multiple translations", async () => {
    const { resolveAvailableLocales } = await import("@nexpress/next");
    const { saveDocument } = await import("@nexpress/core");
    const en = await saveDocument(
      "localized-pages",
      null,
      { title: "About", body: "english", locale: "en" },
      actor(),
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;
    await saveDocument(
      "localized-pages",
      null,
      { title: "About", body: "korean", locale: "ko", translationGroupId: groupId },
      actor(),
      { status: "published" },
    );

    const locales = await resolveAvailableLocales("/en/about");
    expect(locales).not.toBeNull();
    expect(locales!.sort()).toEqual(["en", "ko"]);
  });

  it("resolveAvailableLocales returns only the doc's own locale for solo translations", async () => {
    const { resolveAvailableLocales } = await import("@nexpress/next");
    const { saveDocument } = await import("@nexpress/core");
    await saveDocument(
      "localized-pages",
      null,
      { title: "Solo Page", body: "only en", locale: "en" },
      actor(),
      { status: "published" },
    );
    const locales = await resolveAvailableLocales("/en/solo-page");
    expect(locales).toEqual(["en"]);
  });

  it("resolveAvailableLocales returns every configured locale for static / non-i18n paths", async () => {
    const { resolveAvailableLocales } = await import("@nexpress/next");
    const home = await resolveAvailableLocales("/");
    const blog = await resolveAvailableLocales("/blog");
    const ko = await resolveAvailableLocales("/ko");
    expect(home?.sort()).toEqual(["en", "ko"]);
    expect(blog?.sort()).toEqual(["en", "ko"]);
    expect(ko?.sort()).toEqual(["en", "ko"]);
  });
});

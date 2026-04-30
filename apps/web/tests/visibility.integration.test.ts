import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

/**
 * Phase 21.17 — per-doc `visibility` flag. The framework adds a
 * `visibility text default 'public' not null` column to every
 * collection; anonymous reads in `findDocuments` auto-restrict
 * to `visibility = "public"`, authenticated principals see both.
 * WP imports use `visibility="private"` for `<wp:status>private`
 * posts so they round-trip without the old draft coercion.
 */
describe.skipIf(skipIfNoTestDb())("per-doc visibility (Phase 21.17)", () => {
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

  it("anonymous reads filter out visibility='private' rows automatically", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    await saveDocument(
      "posts",
      null,
      {
        title: "Public",
        slug: "pub",
        content: { root: { type: "root", children: [] } },
        publishedAt: new Date().toISOString(),
        author: admin.userId,
      },
      actor(),
      { status: "published" },
    );
    await saveDocument(
      "posts",
      null,
      {
        title: "Private",
        slug: "priv",
        content: { root: { type: "root", children: [] } },
        publishedAt: new Date().toISOString(),
        author: admin.userId,
        visibility: "private",
      },
      actor(),
      { status: "published" },
    );

    // Anonymous (no `user` arg) — only the public row surfaces.
    const anon = await findDocuments("posts", {});
    const titles = anon.docs.map((d) => d.title).sort();
    expect(titles).toEqual(["Public"]);

    // Authenticated — both rows visible.
    const authed = await findDocuments("posts", {}, actor());
    const authedTitles = authed.docs.map((d) => d.title).sort();
    expect(authedTitles).toEqual(["Private", "Public"]);
  });

  it("explicit `where.visibility` overrides the auto-filter", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    await saveDocument(
      "posts",
      null,
      {
        title: "Hidden",
        slug: "hid",
        content: { root: { type: "root", children: [] } },
        publishedAt: new Date().toISOString(),
        author: admin.userId,
        visibility: "private",
      },
      actor(),
      { status: "published" },
    );

    // Caller explicitly asks for private rows even without a user.
    const privOnly = await findDocuments("posts", {
      where: { visibility: "private" },
    });
    expect(privOnly.docs).toHaveLength(1);

    // Sentinel `*` drops the filter entirely (same shape as siteId).
    const everything = await findDocuments("posts", {
      where: { visibility: "*" },
    });
    expect(everything.docs).toHaveLength(1);
  });

  it("visibility defaults to 'public' when not specified on a write", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    await saveDocument(
      "posts",
      null,
      {
        title: "Default",
        slug: "def",
        content: { root: { type: "root", children: [] } },
        publishedAt: new Date().toISOString(),
        author: admin.userId,
      },
      actor(),
      { status: "published" },
    );
    const result = await findDocuments("posts", {});
    expect(result.docs).toHaveLength(1);
    expect((result.docs[0] as { visibility: string }).visibility).toBe("public");
  });

  it("rejects an unknown visibility value at the Zod boundary", async () => {
    const { saveDocument } = await import("@nexpress/core");
    await expect(
      saveDocument(
        "posts",
        null,
        {
          title: "Bad",
          slug: "bad",
          content: { root: { type: "root", children: [] } },
          publishedAt: new Date().toISOString(),
          author: admin.userId,
          visibility: "secret",
        },
        actor(),
        { status: "published" },
      ),
    ).rejects.toThrow(/visibility/i);
  });

  it("UPDATE preserves visibility unless the caller explicitly changes it", async () => {
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    const created = await saveDocument(
      "posts",
      null,
      {
        title: "UpdMe",
        slug: "upd",
        content: { root: { type: "root", children: [] } },
        publishedAt: new Date().toISOString(),
        author: admin.userId,
        visibility: "private",
      },
      actor(),
      { status: "published" },
    );
    const id = created.doc.id as string;

    // Update without touching visibility — sticky private.
    await saveDocument(
      "posts",
      id,
      {
        title: "UpdMe (edited)",
        slug: "upd",
        content: { root: { type: "root", children: [] } },
        publishedAt: new Date().toISOString(),
        author: admin.userId,
      },
      actor(),
    );
    let anon = await findDocuments("posts", {});
    expect(anon.docs).toHaveLength(0); // still hidden

    // Flip back to public via UPDATE.
    await saveDocument(
      "posts",
      id,
      {
        title: "UpdMe (public)",
        slug: "upd",
        content: { root: { type: "root", children: [] } },
        publishedAt: new Date().toISOString(),
        author: admin.userId,
        visibility: "public",
      },
      actor(),
    );
    anon = await findDocuments("posts", {});
    expect(anon.docs).toHaveLength(1);
    expect((anon.docs[0] as { visibility: string }).visibility).toBe("public");
  });

  it("i18n collections honor the same visibility rules", async () => {
    // Codegen adds the column to every collection — pin the
    // expectation that an i18n collection (`localized-pages`)
    // gets the same anon-hides-private behavior, so a
    // future codegen split that excluded i18n tables would
    // fail this suite.
    const { saveDocument, findDocuments } = await import("@nexpress/core");
    await saveDocument(
      "localized-pages",
      null,
      { title: "MemberOnly", body: "shh", locale: "en", visibility: "private" },
      actor(),
      { status: "published" },
    );
    const anon = await findDocuments("localized-pages", { locale: "en" });
    expect(anon.docs).toHaveLength(0);

    const authed = await findDocuments(
      "localized-pages",
      { locale: "en" },
      actor(),
    );
    expect(authed.docs).toHaveLength(1);
    expect((authed.docs[0] as { visibility: string }).visibility).toBe(
      "private",
    );
  });

  it("WP-import: status='private' lands as published+private and stays anonymous-hidden", async () => {
    const { applyBundle } = await import("@nexpress/wp-import");
    const { findDocuments } = await import("@nexpress/core");
    const bundle = {
      site: {
        title: "Test",
        link: "https://example.com",
        description: "",
        baseSiteUrl: "https://example.com",
        baseBlogUrl: "https://example.com",
        language: "en",
      },
      authors: [],
      // `terms` is required at the bundle level (Phase 21.6 added
      // the cross-record taxonomy resolution); pass an empty array
      // since this fixture doesn't exercise categories/tags.
      terms: [],
      records: [
        {
          wpId: 1,
          wpType: "post",
          status: "private" as const,
          slug: "members-only",
          title: "Members only post",
          excerpt: null,
          rawContent: "<p>Hidden from anonymous</p>",
          wpAuthorLogin: "",
          publishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          terms: [],
          meta: {},
          mediaRefs: [],
          comments: [],
        },
      ],
      attachments: [],
    };

    const report = await applyBundle(bundle, { actor: actor(), dryRun: false });
    expect(report.applied).toHaveLength(1);
    expect(
      report.notes.some((n) => /visibility=private/.test(n)),
    ).toBe(true);

    // Anonymous read — the imported post is hidden by the
    // auto-filter (visibility=public default).
    const anon = await findDocuments("posts", {});
    expect(anon.docs).toHaveLength(0);

    // Authenticated read — the imported post is visible. Use the
    // visibility=* sentinel so we don't depend on the actual slug
    // (the pipeline's slugField may derive a different slug from
    // the title than the WP record's slug).
    const authed = await findDocuments(
      "posts",
      { where: { visibility: "*" } },
      actor(),
    );
    expect(authed.docs).toHaveLength(1);
    expect((authed.docs[0] as { visibility: string }).visibility).toBe(
      "private",
    );
    expect((authed.docs[0] as { status: string }).status).toBe("published");
  });
});

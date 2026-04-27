import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
 * Phase 15.2 — collection scoping. Pin the site_id stamp on
 * writes, the auto-filter on reads, the per-site slug
 * uniqueness, and the `siteId: "*"` cross-site sentinel for
 * super-admin contexts.
 */
describe.skipIf(skipIfNoTestDb())(
  "multi-site collection scoping (Phase 15.2)",
  () => {
    beforeAll(async () => {
      await ensureMigrated();
      registerTestCollections();
      const { ensureCoreServices } = await import("@/lib/init-core");
      ensureCoreServices();
    });
    beforeEach(async () => {
      await truncateAll();
      // Wipe non-default sites so previous tests don't leak.
      const { listSites, deleteSite, resetCurrentSiteResolver } = await import(
        "@nexpress/core"
      );
      const sites = await listSites();
      for (const site of sites) {
        if (!site.isDefault) await deleteSite(site.id);
      }
      resetCurrentSiteResolver();
    });
    afterEach(async () => {
      const { resetCurrentSiteResolver } = await import("@nexpress/core");
      resetCurrentSiteResolver();
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

    it("a write with no site context stamps siteId='default'", async () => {
      const { saveDocument, findDocuments } = await import("@nexpress/core");
      const result = await saveDocument(
        "posts",
        null,
        {
          title: "Default-stamped",
          excerpt: "x",
          content: lexicalParagraph("body"),
          publishedAt: new Date().toISOString(),
          author: session.userId,
        },
        actor(),
        { status: "published" },
      );
      expect((result.doc as { siteId?: string }).siteId).toBe("default");

      // findDocuments with no context returns the row (default
      // filter matches the default-stamped write).
      const found = await findDocuments("posts", { limit: 10 });
      expect(found.totalDocs).toBe(1);
    });

    it("a write inside withCurrentSite stamps that site's id", async () => {
      const { createSite, saveDocument, withCurrentSite, findDocuments } =
        await import("@nexpress/core");
      await createSite({
        id: "acme",
        name: "Acme",
        hostname: "acme.example.com",
      });

      const created = await withCurrentSite("acme", async () => {
        return await saveDocument(
          "posts",
          null,
          {
            title: "Acme post",
            excerpt: "x",
            content: lexicalParagraph("acme body"),
            publishedAt: new Date().toISOString(),
            author: session.userId,
          },
          actor(),
          { status: "published" },
        );
      });
      expect((created.doc as { siteId?: string }).siteId).toBe("acme");

      // Reading WITHOUT site context filters to default — and
      // the acme post should NOT show up.
      const defaultView = await findDocuments("posts", { limit: 10 });
      expect(defaultView.totalDocs).toBe(0);

      // Reading INSIDE acme context shows the post.
      const acmeView = await withCurrentSite("acme", async () => {
        return await findDocuments("posts", { limit: 10 });
      });
      expect(acmeView.totalDocs).toBe(1);
    });

    it("the same slug can exist on two different sites (per-site slug uniqueness)", async () => {
      const { createSite, saveDocument, withCurrentSite, findDocuments } =
        await import("@nexpress/core");
      await createSite({ id: "site-a", name: "A" });
      await createSite({ id: "site-b", name: "B" });

      // Both writes use the same title → same derived slug.
      const a = await withCurrentSite("site-a", async () => {
        return await saveDocument(
          "pages",
          null,
          { title: "About", seoDescription: "..." },
          actor(),
          { status: "published" },
        );
      });
      const b = await withCurrentSite("site-b", async () => {
        return await saveDocument(
          "pages",
          null,
          { title: "About", seoDescription: "..." },
          actor(),
          { status: "published" },
        );
      });
      expect((a.doc as { slug?: string }).slug).toBe("about");
      expect((b.doc as { slug?: string }).slug).toBe("about");
      expect((a.doc as { siteId?: string }).siteId).toBe("site-a");
      expect((b.doc as { siteId?: string }).siteId).toBe("site-b");

      // Each site sees only its own row.
      const aView = await withCurrentSite("site-a", async () =>
        findDocuments("pages", { limit: 10 }),
      );
      expect(aView.totalDocs).toBe(1);
      expect(aView.docs[0]?.id).toBe(a.doc.id);
    });

    it("the same slug COLLIDES within one site (single-tenant uniqueness preserved)", async () => {
      const { saveDocument, withCurrentSite, NxValidationError } = await import(
        "@nexpress/core"
      );
      await withCurrentSite("default", async () => {
        await saveDocument(
          "pages",
          null,
          { title: "Solo", seoDescription: "..." },
          actor(),
          { status: "published" },
        );
        // Second write with same title → same slug in same site
        // → unique-index violation.
        await expect(
          saveDocument(
            "pages",
            null,
            { title: "Solo", seoDescription: "..." },
            actor(),
            { status: "published" },
          ),
        ).rejects.toThrow();
      });
      // Suppress unused-import lint; the import exists for the
      // type assertion below.
      void NxValidationError;
    });

    it("updates can't reassign a row to a different site (siteId is sticky)", async () => {
      const { createSite, saveDocument, withCurrentSite, findDocuments } =
        await import("@nexpress/core");
      await createSite({ id: "stick", name: "Stick" });

      const created = await withCurrentSite("stick", async () => {
        return await saveDocument(
          "posts",
          null,
          {
            title: "Sticky",
            excerpt: "x",
            content: lexicalParagraph("body"),
            publishedAt: new Date().toISOString(),
            author: session.userId,
          },
          actor(),
          { status: "published" },
        );
      });
      const id = created.doc.id as string;

      // Try updating from default-site context with a body
      // field that tries to flip siteId — pipeline must
      // ignore.
      await saveDocument(
        "posts",
        id,
        {
          title: "Sticky updated",
          excerpt: "x",
          content: lexicalParagraph("body"),
          publishedAt: new Date().toISOString(),
          author: session.userId,
          siteId: "default",
        },
        actor(),
      );

      // Row should still belong to "stick".
      const stickView = await withCurrentSite("stick", async () =>
        findDocuments("posts", { limit: 10 }),
      );
      expect(stickView.totalDocs).toBe(1);
      expect(stickView.docs[0]?.id).toBe(id);
    });

    it('the `siteId: "*"` sentinel disables the filter (super-admin cross-site reads)', async () => {
      const { createSite, saveDocument, withCurrentSite, findDocuments } =
        await import("@nexpress/core");
      await createSite({ id: "alpha", name: "Alpha" });
      await createSite({ id: "beta", name: "Beta" });

      await withCurrentSite("alpha", async () =>
        saveDocument(
          "posts",
          null,
          {
            title: "Alpha post",
            excerpt: "x",
            content: lexicalParagraph("a"),
            publishedAt: new Date().toISOString(),
            author: session.userId,
          },
          actor(),
          { status: "published" },
        ),
      );
      await withCurrentSite("beta", async () =>
        saveDocument(
          "posts",
          null,
          {
            title: "Beta post",
            excerpt: "x",
            content: lexicalParagraph("b"),
            publishedAt: new Date().toISOString(),
            author: session.userId,
          },
          actor(),
          { status: "published" },
        ),
      );

      // No site context, no sentinel → default site's view (0 rows).
      const isolated = await findDocuments("posts", { limit: 10 });
      expect(isolated.totalDocs).toBe(0);

      // Sentinel: see across all sites.
      const all = await findDocuments("posts", {
        limit: 10,
        where: { siteId: "*" },
      });
      expect(all.totalDocs).toBe(2);
    });
  },
);

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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Portfolio `/work/:slug` route guard.
 *
 * Locks the fix: the route filters `findDocuments("posts", { where:
 * { slug, status: "published", kind: "project" } })`. Without the
 * `kind: "project"` clause, a `kind="article"` post that happened to
 * share a slug with a project would be matched at `/work/<slug>` and
 * rendered through `ProjectDetailTemplate` (which expects portfolio's
 * hero / year / role fields) — producing a mangled page for what is
 * canonically a `/blog/<slug>` article.
 *
 * Scope: data-layer query equivalence. The full route invocation
 * (which calls `notFound()` on no match) is exercised by the
 * framework's catch-all route tests; here we assert the query the
 * route runs returns the right rows.
 */
describe.skipIf(skipIfNoTestDb())("portfolio /work/:slug guard", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("plugins");

    // `registerTestCollections()` uses the exact all-theme collection
    // definition that generated `postsTable`, including `kind="project"`.
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  /**
   * Minimal Lexical doc — posts.content is `richText` + required, so
   * any direct `saveDocument` in tests has to provide a parseable
   * tree. Empty root is the cheapest legal payload.
   */
  const EMPTY_CONTENT = {
    version: 1,
    document: {
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: [],
      },
    },
  };

  async function asActor() {
    const user = await seedUser({ role: "admin" });
    return {
      id: user.userId,
      email: user.email,
      name: "Test Admin",
      role: user.role,
      tokenVersion: 0,
    };
  }

  it("returns the project row when slug matches a kind=project post", async () => {
    const actor = await asActor();
    const { findDocuments, saveDocument } = await import("@nexpress/core");
    await saveDocument(
      "posts",
      null,
      {
        title: "Hanmi Gallery",
        slug: "hanmi-gallery",
        kind: "project",
        excerpt: "Identity work for a Mapo gallery.",
        content: EMPTY_CONTENT,
      },
      actor,
      { status: "published" },
    );

    // Mirror the route's query verbatim — including the new
    // `kind: "project"` clause that this PR adds.
    const result = await findDocuments("posts", {
      where: { slug: "hanmi-gallery", status: "published", kind: "project" },
      limit: 1,
    });
    expect(result.docs).toHaveLength(1);
    expect(result.docs[0]).toMatchObject({
      slug: "hanmi-gallery",
      kind: "project",
    });
  });

  it("returns no row when the slug matches a kind=article post — guards against /work/<article-slug> mangling", async () => {
    const actor = await asActor();
    const { findDocuments, saveDocument } = await import("@nexpress/core");
    await saveDocument(
      "posts",
      null,
      // No `kind` set → falls through to posts.kind.defaultValue
      // = "article". Same slug as the previous test's project,
      // proving the only thing keeping these two cases apart is
      // the kind filter.
      {
        title: "Hanmi Gallery (the article)",
        slug: "hanmi-gallery",
        excerpt: "What if it were an article instead.",
        content: EMPTY_CONTENT,
      },
      actor,
      { status: "published" },
    );

    const result = await findDocuments("posts", {
      where: { slug: "hanmi-gallery", status: "published", kind: "project" },
      limit: 1,
    });
    expect(result.docs).toHaveLength(0);
  });
});

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
 * Phase 10.7 — search quality improvements.
 *
 *   1. reindexCollection wraps text in to_tsvector + setweight
 *      (parity with the pipeline write path)
 *   2. title-match outranks body-match for the same query
 *      (field weighting via setweight A vs B)
 *
 * Highlight rendering is unit-tested separately
 * (search-highlight.test.tsx) — pure-JS function, no DB.
 */
describe.skipIf(skipIfNoTestDb())("search quality (Phase 10.7)", () => {
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

  it("reindexCollection survives content with colons (regression: 10.7 fix)", async () => {
    const { reindexCollection, saveDocument } = await import("@nexpress/core");
    // Save a row with colon-bearing content — the pre-10.7
    // reindex path wrote raw text into the tsvector column,
    // which Postgres parsed as tsvector syntax and choked on
    // `key:value` tokens. The fix wraps in to_tsvector +
    // setweight, matching the pipeline's write path.
    await saveDocument(
      "posts",
      null,
      {
        title: "URL handling",
        excerpt: "x",
        content: lexicalParagraph(
          "Visit https://example.com and run pnpm seed:content.",
        ),
        publishedAt: new Date().toISOString(),
        author: session.userId,
      },
      actor(),
      { status: "published" },
    );

    const result = await reindexCollection("posts");
    expect(result.collection).toBe("posts");
    expect(result.processed).toBeGreaterThanOrEqual(1);
  });

  it("title-match outranks body-match for the same query (field weighting)", async () => {
    const { saveDocument, searchCollections } = await import("@nexpress/core");
    // Two posts. Both contain the word "swordfish" exactly once.
    //   - "in-title": the word is in the TITLE (weight A)
    //   - "in-body":  the word is in the BODY (weight B/C)
    // ts_rank applies default weights {D:0.1, C:0.2, B:0.4,
    // A:1.0}, so the title-match should rank ahead.
    await saveDocument(
      "posts",
      null,
      {
        title: "Swordfish — a remarkable fish",
        excerpt: "summary",
        content: lexicalParagraph("Some unrelated body content here."),
        publishedAt: new Date().toISOString(),
        author: session.userId,
      },
      actor(),
      { status: "published" },
    );
    await saveDocument(
      "posts",
      null,
      {
        title: "Marine biology notes",
        excerpt: "summary",
        content: lexicalParagraph("Today I learned about the swordfish."),
        publishedAt: new Date().toISOString(),
        author: session.userId,
      },
      actor(),
      { status: "published" },
    );

    const result = await searchCollections({
      q: "swordfish",
      collections: ["posts"],
      limit: 10,
    });
    expect(result.results.length).toBe(2);
    // Title-match should be first.
    const first = result.results[0]?.doc as { title?: string };
    expect(first?.title).toMatch(/^Swordfish/);
  });

  it("reindex re-applies the weighted vector to existing rows (operator workflow)", async () => {
    const { reindexCollection, saveDocument, searchCollections } = await import(
      "@nexpress/core"
    );

    // Two rows, both contain "tortoise". Title-match first;
    // body-match second.
    await saveDocument(
      "posts",
      null,
      {
        title: "Tortoise reproduction",
        excerpt: "summary",
        content: lexicalParagraph("body unrelated"),
        publishedAt: new Date().toISOString(),
        author: session.userId,
      },
      actor(),
      { status: "published" },
    );
    await saveDocument(
      "posts",
      null,
      {
        title: "Reptile field notes",
        excerpt: "summary",
        content: lexicalParagraph("Spotted a tortoise in the desert."),
        publishedAt: new Date().toISOString(),
        author: session.userId,
      },
      actor(),
      { status: "published" },
    );

    // Reindex (would re-derive weighted vectors for legacy
    // rows that pre-date 10.7; with new writes already
    // weighted this is a no-op-equivalent that exercises the
    // SQL-binding path).
    const reindexed = await reindexCollection("posts");
    expect(reindexed.processed).toBe(2);

    const result = await searchCollections({
      q: "tortoise",
      collections: ["posts"],
      limit: 10,
    });
    expect(result.results.length).toBe(2);
    const first = result.results[0]?.doc as { title?: string };
    expect(first?.title).toMatch(/^Tortoise/);
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

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
 * Regression coverage for the tsvector encoding bug — content
 * that contains tsvector-meaningful punctuation (colons in
 * URLs, "key:value" tokens, etc.) used to crash the write
 * because the pipeline cast the raw text directly to tsvector
 * instead of running it through `to_tsvector('english', ...)`.
 *
 * Lock the fix so a future refactor can't regress it without
 * the suite catching it.
 */
describe.skipIf(skipIfNoTestDb())(
  "search vector encoding (regression — colon-containing content)",
  () => {
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

    it("saves a post with colons in the content (URLs, key:value)", async () => {
      const editor = await seedUser({ role: "editor" });
      const { saveDocument } = await import("@nexpress/core");

      // Content includes a URL ("https://example.com") and a
      // colon-bearing token ("seed:content"), both of which are
      // ambiguous to Postgres's tsvector_in parser. Pre-fix this
      // threw "syntax error in tsvector".
      const data = {
        title: "Colon test",
        excerpt: "URL: https://example.com seed:content",
        content: lexicalParagraph(
          "Visit https://example.com or run pnpm seed:content. The pipeline must encode this text via to_tsvector, not cast it raw.",
        ),
        publishedAt: new Date().toISOString(),
        author: editor.userId,
      };

      const result = await saveDocument(
        "posts",
        null,
        data,
        {
          id: editor.userId,
          email: editor.email,
          name: "Test User",
          role: editor.role,
          tokenVersion: 0,
        },
        { status: "published" },
      );
      expect(result.operation).toBe("create");
      expect(typeof result.doc.id).toBe("string");
    });

    it("colon-containing content is searchable via the full-text search", async () => {
      const editor = await seedUser({ role: "editor" });
      const { saveDocument, findDocuments } = await import("@nexpress/core");
      await saveDocument(
        "posts",
        null,
        {
          title: "URL post",
          excerpt: "shrubbery",
          content: lexicalParagraph("shrubbery rare https://shrubberydb.example/path"),
          publishedAt: new Date().toISOString(),
          author: editor.userId,
        },
        {
          id: editor.userId,
          email: editor.email,
          name: "Test User",
          role: editor.role,
          tokenVersion: 0,
        },
        { status: "published" },
      );

      // The post is searchable by a stem-stable lexeme that
      // appeared in the body — proves to_tsvector tokenized the
      // content correctly. We avoid the URL itself in the search
      // because Postgres's english stemmer treats URLs as one
      // big lexeme that hyphenates oddly.
      const found = await findDocuments("posts", {
        search: "shrubbery",
        limit: 5,
      });
      expect(found.docs.length).toBeGreaterThan(0);
    });
  },
);

function lexicalParagraph(text: string): unknown {
  const document = {
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
  return { version: 1, document };
}

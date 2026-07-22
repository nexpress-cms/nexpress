import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { npReindexCollectionWithProgress } from "../collections/search-api.js";
import { resetSearchAdapter, setSearchAdapter } from "../collections/search-adapter.js";
import { npCreateEmptyRichTextContent } from "../fields/rich-text.js";
import { postsTable, registerTestCollections } from "./fixtures.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";

describe.skipIf(skipIfNoTestDb())("bounded search reindex", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    resetSearchAdapter();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("scans Postgres vectors and external references in fixed cursor batches", async () => {
    const db = await getTestDb();
    await db.insert(postsTable).values(
      Array.from({ length: 101 }, (_, index) => ({
        title: `Batch post ${index.toString().padStart(3, "0")}`,
        slug: `batch-post-${index.toString().padStart(3, "0")}`,
        content: npCreateEmptyRichTextContent(),
      })),
    );

    let externalDocuments = 0;
    setSearchAdapter({
      kind: "capture-batches",
      audience: "document-v1",
      search: () => null,
      indexing: {
        contract: "document-v1",
        write: () => undefined,
        replaceCollection: async (context) => {
          for await (const _document of context.documents) externalDocuments += 1;
        },
      },
    });
    const progress: Array<{ phase: "postgres" | "external"; processed: number }> = [];

    const result = await npReindexCollectionWithProgress("posts", (entry) => {
      progress.push(entry);
    });

    expect(result).toEqual({ collection: "posts", processed: 101 });
    expect(externalDocuments).toBe(101);
    expect(progress).toEqual([
      { phase: "postgres", processed: 100 },
      { phase: "postgres", processed: 101 },
      { phase: "external", processed: 100 },
      { phase: "external", processed: 101 },
    ]);
  });
});

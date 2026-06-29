import { describe, expect, it, vi } from "vitest";

import { revalidatePublishedDocuments } from "./scheduled-publish-revalidate";

describe("scheduled publish revalidation", () => {
  it("revalidates each promoted document and falls back to collection-level busts", async () => {
    const readDocument = vi.fn((_collection: string, id: string) => {
      if (id === "missing") return Promise.resolve(null);
      return Promise.resolve({ id, slug: id });
    });
    const revalidate = vi.fn();

    await revalidatePublishedDocuments(
      {
        posts: ["hello", "missing"],
        pages: [],
      },
      { readDocument, revalidate },
    );

    expect(readDocument).toHaveBeenCalledWith("posts", "hello");
    expect(readDocument).toHaveBeenCalledWith("posts", "missing");
    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(revalidate).toHaveBeenNthCalledWith(1, "posts", { id: "hello", slug: "hello" });
    expect(revalidate).toHaveBeenNthCalledWith(2, "posts");
  });
});

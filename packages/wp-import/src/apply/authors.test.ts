import { describe, expect, it, vi } from "vitest";

import type { WpImportBundle } from "../parse/types.js";
import { resolveAuthors, type AuthorResolver } from "./authors.js";

function makeBundle(overrides: Partial<WpImportBundle>): WpImportBundle {
  return {
    site: {
      title: "X",
      link: "https://x",
      description: "",
      baseSiteUrl: "https://x",
      baseBlogUrl: "https://x",
      language: null,
    },
    authors: [],
    terms: [],
    records: [],
    ...overrides,
  };
}

describe("resolveAuthors", () => {
  it("resolves each unique author login once and skips attachments", async () => {
    const bundle = makeBundle({
      authors: [
        { wpId: 1, login: "alice", email: "alice@example.com", displayName: "Alice", description: null },
      ],
      records: [
        {
          wpId: 1, wpType: "post", status: "publish", slug: "p1", title: "P1",
          excerpt: null, rawContent: "", wpAuthorLogin: "alice",
          publishedAt: "2025-04-01 12:00:00", updatedAt: "2025-04-01 12:00:00",
          terms: [], meta: {}, mediaRefs: [], comments: [],
        },
        {
          wpId: 2, wpType: "post", status: "publish", slug: "p2", title: "P2",
          excerpt: null, rawContent: "", wpAuthorLogin: "alice",
          publishedAt: "2025-04-01 12:00:00", updatedAt: "2025-04-01 12:00:00",
          terms: [], meta: {}, mediaRefs: [], comments: [],
        },
        {
          wpId: 99, wpType: "attachment", status: "publish", slug: "a", title: "A",
          excerpt: null, rawContent: "", wpAuthorLogin: "should-be-ignored",
          publishedAt: "2025-04-01 12:00:00", updatedAt: "2025-04-01 12:00:00",
          terms: [], meta: {}, mediaRefs: [], comments: [],
        },
      ],
    });
    const resolveAuthor = vi.fn(({ wpAuthorLogin, wpAuthor }) =>
      Promise.resolve({ id: `user-${wpAuthorLogin}-${wpAuthor?.email ?? "noemail"}` }),
    );
    const resolver: AuthorResolver = { resolveAuthor };
    const out = await resolveAuthors(bundle, resolver);
    expect(resolveAuthor).toHaveBeenCalledTimes(1);
    expect(out.authorIds.get("alice")).toBe("user-alice-alice@example.com");
    expect(out.skipped).toEqual([]);
    expect(out.errors).toEqual([]);
  });

  it("captures null returns as skips and rejected promises as errors", async () => {
    const bundle = makeBundle({
      records: [
        {
          wpId: 1, wpType: "post", status: "publish", slug: "p1", title: "P1",
          excerpt: null, rawContent: "", wpAuthorLogin: "skipped",
          publishedAt: "", updatedAt: "", terms: [], meta: {}, mediaRefs: [], comments: [],
        },
        {
          wpId: 2, wpType: "post", status: "publish", slug: "p2", title: "P2",
          excerpt: null, rawContent: "", wpAuthorLogin: "boom",
          publishedAt: "", updatedAt: "", terms: [], meta: {}, mediaRefs: [], comments: [],
        },
      ],
    });
    const resolveAuthor = vi.fn(({ wpAuthorLogin }: { wpAuthorLogin: string }) => {
      if (wpAuthorLogin === "skipped") return Promise.resolve(null);
      return Promise.reject(new Error("nope"));
    });
    const out = await resolveAuthors(bundle, { resolveAuthor });
    expect(out.skipped).toEqual(["skipped"]);
    expect(out.errors[0]?.login).toBe("boom");
    expect(out.errors[0]?.reason).toContain("nope");
  });

  it("passes the matching wp:author entry through to the resolver when one exists", async () => {
    const bundle = makeBundle({
      authors: [
        { wpId: 1, login: "alice", email: "a@x.com", displayName: "Alice A.", description: "Bio" },
      ],
      records: [
        {
          wpId: 1, wpType: "post", status: "publish", slug: "p1", title: "P1",
          excerpt: null, rawContent: "", wpAuthorLogin: "alice",
          publishedAt: "", updatedAt: "", terms: [], meta: {}, mediaRefs: [], comments: [],
        },
      ],
    });
    const captured: { wpAuthor?: { email?: string } } = {};
    const resolveAuthor = vi.fn((input: { wpAuthorLogin: string; wpAuthor: { email: string } | undefined }) => {
      captured.wpAuthor = input.wpAuthor;
      return Promise.resolve({ id: "u1" });
    });
    await resolveAuthors(bundle, { resolveAuthor });
    expect(captured.wpAuthor?.email).toBe("a@x.com");
  });
});

import { describe, expect, it, vi } from "vitest";

import type { WpImportRecord, WpTerm } from "../parse/types.js";
import {
  pickPostTermIds,
  resolveTaxonomies,
  termCacheKey,
  type TaxonomyResolver,
} from "./taxonomies.js";

function makeRecord(
  partial: Partial<WpImportRecord> & { wpType?: string; terms?: WpTerm[] },
): WpImportRecord {
  return {
    wpId: 1,
    wpType: partial.wpType ?? "post",
    status: "publish",
    slug: "x",
    title: "X",
    excerpt: null,
    rawContent: "",
    wpAuthorLogin: "alice",
    publishedAt: "2025-04-01 12:00:00",
    updatedAt: "2025-04-01 12:00:00",
    terms: partial.terms ?? [],
    meta: {},
    mediaRefs: [],
    comments: [],
  };
}

describe("resolveTaxonomies", () => {
  it("dedupes terms across records and the channel envelope", async () => {
    const records: WpImportRecord[] = [
      makeRecord({
        terms: [
          { taxonomy: "category", slug: "news", name: "News" },
          { taxonomy: "post_tag", slug: "launch", name: "launch" },
        ],
      }),
      makeRecord({
        wpType: "page",
        terms: [{ taxonomy: "category", slug: "news", name: "News" }],
      }),
    ];
    const channel: WpTerm[] = [
      { taxonomy: "category", slug: "news", name: "News" },
      { taxonomy: "post_tag", slug: "launch", name: "launch" },
    ];
    const findOrCreate = vi.fn((input: { taxonomy: string; slug: string }) =>
      Promise.resolve({ id: `${input.taxonomy}-${input.slug}` }),
    );
    const resolver: TaxonomyResolver = { findOrCreate };

    const out = await resolveTaxonomies(records, channel, resolver);
    // Two unique terms — resolver called once per unique key.
    expect(findOrCreate).toHaveBeenCalledTimes(2);
    expect(out.termIds.get(termCacheKey("category", "news"))).toBe("category-news");
    expect(out.termIds.get(termCacheKey("post_tag", "launch"))).toBe("post_tag-launch");
    expect(out.errors).toEqual([]);
    expect(out.skipped).toEqual([]);
  });

  it("captures resolver errors without aborting the loop", async () => {
    const records = [
      makeRecord({ terms: [{ taxonomy: "category", slug: "ok", name: "OK" }] }),
      makeRecord({ terms: [{ taxonomy: "category", slug: "boom", name: "Boom" }] }),
    ];
    const findOrCreate = vi.fn((input: { slug: string }) =>
      input.slug === "boom"
        ? Promise.reject(new Error("DB blew up"))
        : Promise.resolve({ id: "ok-id" }),
    );
    const out = await resolveTaxonomies(records, [], { findOrCreate });
    expect(out.termIds.get(termCacheKey("category", "ok"))).toBe("ok-id");
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]?.key.slug).toBe("boom");
    expect(out.errors[0]?.reason).toContain("DB blew up");
  });

  it("records terms the resolver explicitly skipped (returned null)", async () => {
    const records = [
      makeRecord({ terms: [{ taxonomy: "custom", slug: "x", name: "X" }] }),
    ];
    const findOrCreate = vi.fn(() => Promise.resolve(null));
    const out = await resolveTaxonomies(records, [], { findOrCreate });
    expect(out.termIds.size).toBe(0);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]?.taxonomy).toBe("custom");
  });

  it("ignores attachment records' terms", async () => {
    const records = [
      makeRecord({
        wpType: "attachment",
        terms: [{ taxonomy: "category", slug: "leak", name: "leak" }],
      }),
    ];
    const findOrCreate = vi.fn(() => Promise.resolve({ id: "ignored" }));
    const out = await resolveTaxonomies(records, [], { findOrCreate });
    expect(findOrCreate).not.toHaveBeenCalled();
    expect(out.termIds.size).toBe(0);
  });

  it("skips terms with empty slugs", async () => {
    const records = [
      makeRecord({ terms: [{ taxonomy: "category", slug: "", name: "Anonymous" }] }),
    ];
    const findOrCreate = vi.fn(() => Promise.resolve({ id: "x" }));
    const out = await resolveTaxonomies(records, [], { findOrCreate });
    expect(findOrCreate).not.toHaveBeenCalled();
    expect(out.termIds.size).toBe(0);
  });
});

describe("pickPostTermIds", () => {
  it("partitions resolved ids into category vs tag", () => {
    const record = makeRecord({
      terms: [
        { taxonomy: "category", slug: "news", name: "News" },
        { taxonomy: "category", slug: "tech", name: "Tech" },
        { taxonomy: "post_tag", slug: "launch", name: "launch" },
      ],
    });
    const resolution = {
      termIds: new Map([
        [termCacheKey("category", "news"), "cat-news"],
        [termCacheKey("category", "tech"), "cat-tech"],
        [termCacheKey("post_tag", "launch"), "tag-launch"],
      ]),
      errors: [],
      skipped: [],
    };
    const out = pickPostTermIds(record, resolution);
    expect(out.categoryIds).toEqual(["cat-news", "cat-tech"]);
    expect(out.tagIds).toEqual(["tag-launch"]);
  });

  it("drops terms outside category/post_tag", () => {
    const record = makeRecord({
      terms: [
        { taxonomy: "category", slug: "news", name: "News" },
        { taxonomy: "custom", slug: "weird", name: "Weird" },
      ],
    });
    const resolution = {
      termIds: new Map([
        [termCacheKey("category", "news"), "cat-news"],
        [termCacheKey("custom", "weird"), "weird-id"],
      ]),
      errors: [],
      skipped: [],
    };
    const out = pickPostTermIds(record, resolution);
    expect(out.categoryIds).toEqual(["cat-news"]);
    expect(out.tagIds).toEqual([]);
  });

  it("dedupes within a single record", () => {
    const record = makeRecord({
      terms: [
        { taxonomy: "category", slug: "news", name: "News" },
        { taxonomy: "category", slug: "news", name: "News" },
      ],
    });
    const resolution = {
      termIds: new Map([[termCacheKey("category", "news"), "cat-news"]]),
      errors: [],
      skipped: [],
    };
    const out = pickPostTermIds(record, resolution);
    expect(out.categoryIds).toEqual(["cat-news"]);
  });
});

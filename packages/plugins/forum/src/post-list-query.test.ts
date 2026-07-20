import { describe, expect, it } from "vitest";

import {
  buildForumPostListHref,
  npForumPostListQueryLimits,
  parseForumPostListQuery,
} from "./routes/post-list-query.js";

const categories = [
  { key: "question", label: "질문" },
  { key: "guide", label: "가이드" },
];

describe("forum post-list query contract", () => {
  it("normalizes the supported query and ignores unrelated decorations", () => {
    expect(
      parseForumPostListQuery(
        {
          page: "2",
          q: "  한글\t검색어  ",
          category: "question",
          author: "me",
          utm_source: "newsletter",
        },
        categories,
      ),
    ).toEqual({ page: 2, search: "한글 검색어", category: "question", showMine: true });
  });

  it.each([
    [{ page: "0" }, "zero page"],
    [{ page: "01" }, "non-canonical page"],
    [{ page: String(npForumPostListQueryLimits.page + 1) }, "oversized page"],
    [{ page: ["1", "2"] }, "duplicated page"],
    [{ q: ["one", "two"] }, "duplicated search"],
    [{ q: "x".repeat(npForumPostListQueryLimits.searchLength + 1) }, "oversized search"],
    [{ category: "missing" }, "unknown category"],
    [{ author: "staff" }, "unsupported author"],
  ])("rejects %s (%s)", (searchParams, _label) => {
    expect(parseForumPostListQuery(searchParams, categories)).toBeNull();
  });

  it("builds stable links while omitting default query state", () => {
    const current = {
      page: 3,
      search: "검색어",
      category: "question",
      showMine: true,
    };

    expect(buildForumPostListHref("/boards", "free", current, { page: 4 })).toBe(
      "/boards/free?category=question&q=%EA%B2%80%EC%83%89%EC%96%B4&author=me&page=4",
    );
    expect(buildForumPostListHref("/boards", "free", current, { category: "guide" })).toBe(
      "/boards/free?category=guide&q=%EA%B2%80%EC%83%89%EC%96%B4&author=me",
    );
    expect(
      buildForumPostListHref("/boards", "free", current, {
        page: 1,
        search: null,
        category: null,
        showMine: false,
      }),
    ).toBe("/boards/free");
  });
});

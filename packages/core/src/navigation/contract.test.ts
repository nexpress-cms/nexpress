import { describe, expect, it } from "vitest";

import {
  isNpNavigationItems,
  isNpNavigationLocation,
  npAnalyzeNavigationItems,
  npNavigationItemTypes,
  npNavigationMaxDepth,
  npNavigationMaxItems,
  npValidateNavigationItems,
} from "./contract.js";

describe("navigation contract", () => {
  it("publishes the canonical item inventory and accepts exact discriminated trees", () => {
    const items = [
      {
        id: "primary",
        label: "Primary",
        type: "link",
        url: "/",
        children: [
          {
            id: "docs",
            label: "Docs",
            type: "page",
            pageId: "9b3dd862-3727-41b0-a2fa-f87362af6da0",
            collectionSlug: "pages",
          },
        ],
      },
      { id: "posts", label: "Posts", type: "collection", collection: "posts" },
      { id: "github", label: "GitHub", type: "link", url: "https://github.com" },
      { id: "email", label: "Email", type: "link", url: "mailto:hello@example.com" },
    ];

    expect(npNavigationItemTypes).toEqual(["link", "collection", "page"]);
    expect(npNavigationMaxDepth).toBe(2);
    expect(npValidateNavigationItems(items)).toEqual({ ok: true });
    expect(isNpNavigationItems(items)).toBe(true);
  });

  it("rejects missing, extra, and cross-kind fields", () => {
    expect(
      npAnalyzeNavigationItems([{ id: "link", label: "Link", type: "link" }])[0],
    ).toMatchObject({ path: "navigation.items.0.url", code: "invalid-field" });
    expect(
      npAnalyzeNavigationItems([
        { id: "link", label: "Link", type: "link", url: "/", pageId: "page" },
      ]),
    ).toContainEqual(
      expect.objectContaining({ path: "navigation.items.0.pageId", code: "unknown-field" }),
    );
    expect(
      npAnalyzeNavigationItems([
        { id: "page", label: "Page", type: "page", pageId: "page", extra: true },
      ]),
    ).toContainEqual(
      expect.objectContaining({ path: "navigation.items.0.extra", code: "unknown-field" }),
    );
  });

  it("enforces safe ids, labels, slugs, and link URL schemes", () => {
    expect(
      npAnalyzeNavigationItems([
        { id: " bad", label: " Bad ", type: "link", url: "javascript:alert(1)" },
        { id: "collection", label: "Collection", type: "collection", collection: "Bad Slug" },
        {
          id: "collection-two",
          label: "Collection two",
          type: "collection",
          collection: "bad--slug",
        },
        { id: "page", label: "Page", type: "page", pageId: "bad id" },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "navigation.items.0.id" }),
        expect.objectContaining({ path: "navigation.items.0.label" }),
        expect.objectContaining({ path: "navigation.items.0.url" }),
        expect.objectContaining({ path: "navigation.items.1.collection" }),
        expect.objectContaining({ path: "navigation.items.2.collection" }),
        expect.objectContaining({ path: "navigation.items.3.pageId" }),
      ]),
    );
    expect(
      npAnalyzeNavigationItems([
        { id: "protocol-relative", label: "Unsafe", type: "link", url: "//example.com" },
      ])[0],
    ).toMatchObject({ path: "navigation.items.0.url" });
  });

  it("requires ids to be unique across the complete tree", () => {
    expect(
      npAnalyzeNavigationItems([
        {
          id: "duplicate",
          label: "Parent",
          type: "link",
          url: "/",
          children: [{ id: "duplicate", label: "Child", type: "link", url: "/child" }],
        },
      ]),
    ).toContainEqual(
      expect.objectContaining({
        code: "duplicate-id",
        path: "navigation.items.0.children.0.id",
      }),
    );
  });

  it("bounds depth and total item count", () => {
    expect(
      npAnalyzeNavigationItems([
        {
          id: "one",
          label: "One",
          type: "link",
          url: "/one",
          children: [
            {
              id: "two",
              label: "Two",
              type: "link",
              url: "/two",
              children: [{ id: "three", label: "Three", type: "link", url: "/three" }],
            },
          ],
        },
      ]),
    ).toContainEqual(expect.objectContaining({ code: "max-depth" }));

    const tooMany = Array.from({ length: npNavigationMaxItems + 1 }, (_, index) => ({
      id: `item-${index.toString()}`,
      label: `Item ${index.toString()}`,
      type: "link",
      url: `/item-${index.toString()}`,
    }));
    expect(npAnalyzeNavigationItems(tooMany)).toContainEqual(
      expect.objectContaining({ code: "max-items", path: "navigation.items" }),
    );
  });

  it("rejects circular module-authored trees and invalid location slugs", () => {
    const item: Record<string, unknown> = {
      id: "cycle",
      label: "Cycle",
      type: "link",
      url: "/",
    };
    item.children = [item];
    expect(npAnalyzeNavigationItems([item])).toContainEqual(
      expect.objectContaining({ code: "shape", message: expect.stringMatching(/circular/) }),
    );

    expect(isNpNavigationLocation("header")).toBe(true);
    expect(isNpNavigationLocation("footer-links")).toBe(true);
    expect(isNpNavigationLocation("Header")).toBe(false);
    expect(isNpNavigationLocation("bad_slug")).toBe(false);
    expect(isNpNavigationLocation("bad--slug")).toBe(false);
    expect(isNpNavigationLocation("bad-")).toBe(false);
    expect(isNpNavigationLocation("a".repeat(64))).toBe(false);
  });
});

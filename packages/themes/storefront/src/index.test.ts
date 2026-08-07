import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { storefrontCss, storefrontTheme } from "./index.js";

describe("storefront theme contract", () => {
  it("works independently from Shop collections and package imports", () => {
    expect(storefrontTheme.manifest.id).toBe("storefront");
    expect(storefrontTheme.impl.templates?.pages).toHaveProperty("front");
    expect(storefrontTheme.impl.templates?.posts).toHaveProperty("list");
    expect(storefrontTheme.impl.seedContent?.pages?.length).toBeGreaterThan(0);

    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies).not.toHaveProperty("@nexpress/plugin-shop");
  });

  it("enhances an optional Shop only through stable public style hooks", () => {
    for (const property of [
      "--np-shop-content-max",
      "--np-shop-surface",
      "--np-shop-soft",
      "--np-shop-ink",
      "--np-shop-subtle",
      "--np-shop-line",
      "--np-shop-accent",
      "--np-shop-accent-foreground",
    ]) {
      expect(storefrontCss).toContain(`${property}:`);
    }
    expect(storefrontCss).toContain(".np-shop[data-np-shop-skin]");
    expect(storefrontCss).toContain("[data-np-shop-block]");
    expect(storefrontCss).toContain('[data-np-shop-surface="cart"]');
    expect(storefrontCss).toContain('[data-np-shop-surface="checkout"]');
    expect(storefrontCss).toContain('[data-np-shop-surface="order-draft"]');
    expect(storefrontCss).toContain('[data-np-shop-surface="orders"]');
    expect(storefrontCss).toContain('[data-np-shop-surface="order"]');
    expect(storefrontCss).toContain("[data-np-shop-reviews]");
    expect(storefrontCss).toContain("[data-np-shop-review-form]");
  });
});

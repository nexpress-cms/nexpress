import { describe, expect, it } from "vitest";

import { defaultTheme } from "@nexpress/theme-default";
import { docsTheme } from "@nexpress/theme-docs";
import { magazineTheme } from "@nexpress/theme-magazine";
import { portfolioTheme } from "@nexpress/theme-portfolio";
import type { NpThemeDefinition } from "@nexpress/theme";

const FRAMEWORK_ROUTES = new Set(["/blog"]);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pagePath(page: { title?: string; slug?: string }): string {
  const slug = page.slug ?? slugify(page.title ?? "");
  if (slug === "/" || slug === "") return "/";
  return slug.startsWith("/") ? slug : `/${slug}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routePatternToRegex(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      const constrained = /^:([A-Za-z0-9_]+)\((.+)\)$/.exec(segment);
      if (constrained) return `(?:${constrained[2]})`;
      if (segment.startsWith(":")) return "[^/]+";
      return escapeRegex(segment);
    })
    .join("/");
  return new RegExp(`^${body}$`);
}

function assertLocalNavTargetsResolve(theme: NpThemeDefinition): void {
  const pages = new Set((theme.impl.seedContent?.pages ?? []).map(pagePath));
  const routeRegexes = (theme.impl.routes ?? []).map((route) => routePatternToRegex(route.pattern));
  const navItems = Object.values(theme.impl.seedContent?.navigation ?? {}).flat();

  const unresolved = navItems
    .map((item) => item.url)
    .filter((url): url is string => typeof url === "string" && url.startsWith("/"))
    .filter((url) => {
      const pathname = url.split("?")[0] ?? url;
      return (
        !pages.has(pathname) &&
        !FRAMEWORK_ROUTES.has(pathname) &&
        !routeRegexes.some((regex) => regex.test(pathname))
      );
    });

  expect(unresolved).toEqual([]);
}

describe("built-in theme seed parity", () => {
  it("default seeds About and points local nav at pages or theme routes", () => {
    const pages = defaultTheme.impl.seedContent?.pages ?? [];
    expect(pages).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "about", template: "about" })]),
    );
    expect(defaultTheme.impl.templates?.pages?.about).toBeDefined();
    expect(defaultTheme.impl.routes?.map((route) => route.pattern)).toContain("/tag/:slug");
    assertLocalNavTargetsResolve(defaultTheme);
  });

  it("docs seeds API reference and changelog pages with dedicated templates", () => {
    const pages = docsTheme.impl.seedContent?.pages ?? [];
    expect(pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "docs/reference/define-plugin",
          template: "apiReference",
        }),
        expect.objectContaining({ slug: "changelog", template: "changelog" }),
      ]),
    );
    expect(docsTheme.impl.templates?.pages?.apiReference).toBeDefined();
    expect(docsTheme.impl.templates?.pages?.changelog).toBeDefined();
    assertLocalNavTargetsResolve(docsTheme);
  });

  it("magazine seeds Masthead and routes every designed section archive", () => {
    const pages = magazineTheme.impl.seedContent?.pages ?? [];
    expect(pages).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "masthead", template: "masthead" })]),
    );
    expect(magazineTheme.impl.templates?.pages?.masthead).toBeDefined();
    expect(magazineTheme.impl.routes?.map((route) => route.pattern)).toContain(
      "/:section(features|dispatches|profiles|essays|photography)",
    );
    assertLocalNavTargetsResolve(magazineTheme);
  });

  it("portfolio seeds Studio, Journal, Press and separates projects from journal posts", () => {
    const pages = portfolioTheme.impl.seedContent?.pages ?? [];
    expect(pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "studio", template: "studio" }),
        expect.objectContaining({ slug: "journal", template: "journal" }),
        expect.objectContaining({ slug: "press", template: "press" }),
      ]),
    );
    expect(portfolioTheme.impl.templates?.pages?.studio).toBeDefined();
    expect(portfolioTheme.impl.templates?.pages?.journal).toBeDefined();
    expect(portfolioTheme.impl.templates?.pages?.press).toBeDefined();

    const posts = portfolioTheme.impl.seedContent?.posts ?? [];
    expect(posts.filter((post) => post.kind === "project").length).toBeGreaterThan(0);
    expect(posts.filter((post) => post.kind === "article").length).toBeGreaterThan(0);
    assertLocalNavTargetsResolve(portfolioTheme);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { resetI18nConfig, setI18nConfig } from "./registry.js";
import { getCurrentLocale, resolveLocale } from "./locale-resolver.js";

afterEach(() => {
  resetI18nConfig();
});

function configure(locales: string[], defaultLocale: string): void {
  setI18nConfig({
    locales,
    defaultLocale,
  });
}

describe("resolveLocale", () => {
  it("returns null when i18n isn't configured", () => {
    expect(resolveLocale({ pathname: "/en/blog" })).toBeNull();
  });

  it("matches a configured locale prefix on the pathname", () => {
    configure(["en", "ko"], "en");
    expect(resolveLocale({ pathname: "/ko/blog" })).toEqual({
      locale: "ko",
      source: "path",
      pathnameWithoutLocale: "/blog",
    });
  });

  it("strips multi-segment paths correctly", () => {
    configure(["en", "ko"], "en");
    expect(resolveLocale({ pathname: "/ko/blog/2026/post-1" })).toEqual({
      locale: "ko",
      source: "path",
      pathnameWithoutLocale: "/blog/2026/post-1",
    });
  });

  it("returns root when only the locale segment is present", () => {
    configure(["en", "ko"], "en");
    expect(resolveLocale({ pathname: "/ko" })?.pathnameWithoutLocale).toBe("/");
    expect(resolveLocale({ pathname: "/ko/" })?.pathnameWithoutLocale).toBe("/");
  });

  it("falls back to Accept-Language when the path has no locale prefix", () => {
    configure(["en", "ko", "ja"], "en");
    expect(
      resolveLocale({
        pathname: "/blog",
        acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.5",
      }),
    ).toEqual({
      locale: "ja",
      source: "header",
      pathnameWithoutLocale: "/blog",
    });
  });

  it("honors quality factors when picking from Accept-Language", () => {
    configure(["en", "ko"], "en");
    // ko has q=0.3, en has q=0.9 → en wins despite ko appearing first
    const result = resolveLocale({
      acceptLanguage: "ko;q=0.3, en;q=0.9",
    });
    expect(result?.locale).toBe("en");
    expect(result?.source).toBe("header");
  });

  it("matches the primary subtag when the full tag isn't configured", () => {
    configure(["en", "ko"], "en");
    expect(resolveLocale({ acceptLanguage: "en-US,en-GB;q=0.9" })?.locale).toBe("en");
  });

  it("ignores unconfigured locales in Accept-Language", () => {
    configure(["en", "ko"], "en");
    expect(
      resolveLocale({ acceptLanguage: "fr-FR,de;q=0.7" })?.locale,
    ).toBe("en");
    // Falls back to default, marked as such.
    expect(
      resolveLocale({ acceptLanguage: "fr-FR,de;q=0.7" })?.source,
    ).toBe("default");
  });

  it("falls back to the default locale when nothing matches", () => {
    configure(["en", "ko"], "ko");
    expect(resolveLocale({ pathname: "/blog" })).toEqual({
      locale: "ko",
      source: "default",
      pathnameWithoutLocale: "/blog",
    });
  });

  it("path always beats header (path is more specific)", () => {
    configure(["en", "ko"], "en");
    expect(
      resolveLocale({
        pathname: "/ko/blog",
        acceptLanguage: "en-US,en;q=0.9",
      })?.locale,
    ).toBe("ko");
  });

  it("ignores wildcard `*` in Accept-Language", () => {
    configure(["en", "ko"], "en");
    expect(resolveLocale({ acceptLanguage: "*" })?.source).toBe("default");
  });
});

describe("getCurrentLocale", () => {
  it("returns the resolved locale when i18n is configured", () => {
    configure(["en", "ko"], "en");
    expect(getCurrentLocale({ pathname: "/ko/x" })).toBe("ko");
  });

  it("returns 'en' as a hard fallback when i18n isn't configured", () => {
    expect(getCurrentLocale({ pathname: "/en/x" })).toBe("en");
  });
});

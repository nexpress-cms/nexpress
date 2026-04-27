import { afterEach, describe, expect, it } from "vitest";

import { resetI18nConfig, setI18nConfig } from "./registry.js";
import {
  addStrings,
  getAllStrings,
  resetStrings,
  setStrings,
  t,
} from "./strings.js";

describe("UI string registry (Phase 12.5)", () => {
  afterEach(() => {
    resetStrings();
    resetI18nConfig();
  });

  it("t() resolves from the requested locale's bundle", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { hello: "Hello" });
    addStrings("ko", { hello: "안녕" });
    expect(t("hello", "en")).toBe("Hello");
    expect(t("hello", "ko")).toBe("안녕");
  });

  it("t() falls back to the default locale when the requested key is missing", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { byKeyOnly: "English fallback" });
    expect(t("byKeyOnly", "ko")).toBe("English fallback");
  });

  it("t() falls back to the key itself when no bundle has it (operator-visible miss)", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    expect(t("totallyMissingKey", "ko")).toBe("totallyMissingKey");
  });

  it("t() interpolates {{name}} placeholders from params", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { greeting: "Hello, {{name}}!" });
    expect(t("greeting", "en", { name: "Bae" })).toBe("Hello, Bae!");
  });

  it("t() leaves placeholders intact when their param is missing (helps surface bugs)", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { greeting: "Hello, {{name}}!" });
    expect(t("greeting", "en")).toBe("Hello, {{name}}!");
  });

  it("addStrings merges into an existing locale; setStrings replaces", () => {
    addStrings("en", { a: "1", b: "2" });
    addStrings("en", { b: "two", c: "3" });
    expect(t("a", "en")).toBe("1");
    expect(t("b", "en")).toBe("two");
    expect(t("c", "en")).toBe("3");

    setStrings("en", { only: "now" });
    expect(t("only", "en")).toBe("now");
    expect(t("a", "en")).toBe("a"); // wiped
  });

  it("getAllStrings exposes the full registry (frozen view per locale)", () => {
    addStrings("en", { hello: "Hello" });
    addStrings("ko", { hello: "안녕" });
    const all = getAllStrings();
    expect(all.en?.hello).toBe("Hello");
    expect(all.ko?.hello).toBe("안녕");
    // The returned object is a copy — mutating it doesn't
    // affect the registry.
    all.en!.hello = "Mutated";
    expect(t("hello", "en")).toBe("Hello");
  });

  it("t() with no `locale` arg uses the configured defaultLocale", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "ko" });
    addStrings("ko", { tagline: "기본은 한국어" });
    addStrings("en", { tagline: "Default English" });
    expect(t("tagline")).toBe("기본은 한국어");
  });

  it("t() with no i18n config and no `locale` arg returns the key (no defaults to fall back on)", () => {
    addStrings("en", { hi: "Hello" });
    // No i18n config registered — t() can't decide a default.
    // The lookup goes: requested (none) → default (none) → key.
    expect(t("hi")).toBe("hi");
  });
});

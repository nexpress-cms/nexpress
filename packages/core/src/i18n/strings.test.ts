import { afterEach, describe, expect, it } from "vitest";

import { resetI18nConfig, setI18nConfig } from "./registry.js";
import {
  addStrings,
  getAllStrings,
  resetStrings,
  setStrings,
  tSync,
} from "./strings.js";

/**
 * These tests cover the bundle lookup behavior — Phase 12.5
 * style. The async `t()` is covered by integration tests
 * (`i18n-string-overrides.integration.test.ts`) since it
 * has to round-trip to the DB for the override layer.
 * `tSync` is the bundle-only resolver so we don't need the
 * DB here.
 */
describe("UI string registry (Phase 12.5 + D bundle behavior)", () => {
  afterEach(() => {
    resetStrings();
    resetI18nConfig();
  });

  it("tSync() resolves from the requested locale's bundle", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { hello: "Hello" });
    addStrings("ko", { hello: "안녕" });
    expect(tSync("hello", "en")).toBe("Hello");
    expect(tSync("hello", "ko")).toBe("안녕");
  });

  it("tSync() falls back to the default locale when the requested key is missing", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { byKeyOnly: "English fallback" });
    expect(tSync("byKeyOnly", "ko")).toBe("English fallback");
  });

  it("tSync() falls back to the key itself when no bundle has it (operator-visible miss)", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    expect(tSync("totallyMissingKey", "ko")).toBe("totallyMissingKey");
  });

  it("tSync() interpolates {{name}} placeholders from params", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { greeting: "Hello, {{name}}!" });
    expect(tSync("greeting", "en", { name: "Bae" })).toBe("Hello, Bae!");
  });

  it("tSync() leaves placeholders intact when their param is missing (helps surface bugs)", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { greeting: "Hello, {{name}}!" });
    expect(tSync("greeting", "en")).toBe("Hello, {{name}}!");
  });

  it("addStrings merges into an existing locale; setStrings replaces", () => {
    addStrings("en", { a: "1", b: "2" });
    addStrings("en", { b: "two", c: "3" });
    expect(tSync("a", "en")).toBe("1");
    expect(tSync("b", "en")).toBe("two");
    expect(tSync("c", "en")).toBe("3");

    setStrings("en", { only: "now" });
    expect(tSync("only", "en")).toBe("now");
    expect(tSync("a", "en")).toBe("a"); // wiped
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
    expect(tSync("hello", "en")).toBe("Hello");
  });

  it("tSync() with no `locale` arg uses the configured defaultLocale", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "ko" });
    addStrings("ko", { tagline: "기본은 한국어" });
    addStrings("en", { tagline: "Default English" });
    expect(tSync("tagline")).toBe("기본은 한국어");
  });

  it("tSync() with no i18n config and no `locale` arg returns the key (no defaults to fall back on)", () => {
    addStrings("en", { hi: "Hello" });
    expect(tSync("hi")).toBe("hi");
  });
});

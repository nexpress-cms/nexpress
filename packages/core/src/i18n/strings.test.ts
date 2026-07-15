import { afterEach, describe, expect, it } from "vitest";

import { resetI18nConfig, setI18nConfig } from "./registry.js";
import {
  addStrings,
  getAllStrings,
  getI18nRuntimeDiagnostics,
  getRegisteredPluginStrings,
  getStrings,
  registerPluginStrings,
  resetStrings,
  resetTranslationCache,
  setStrings,
  tSync,
  unregisterPluginStrings,
} from "./strings.js";

/**
 * These tests cover the bundle lookup behavior — Phase 12.5
 * style. The async `t()` is covered by integration tests
 * (`i18n-string-overrides.integration.test.ts`) since it
 * has to round-trip to the DB for the override layer.
 * `tSync` is the bundle-only resolver so we don't need the
 * DB here.
 *
 * Phase 12.7 — message format upgraded to ICU MessageFormat.
 * The old `{{name}}` syntax was replaced with `{name}` (single
 * braces); plural / select / date / number formatters now
 * follow standard ICU syntax.
 */
describe("UI string registry (Phase 12.5 + D bundle behavior)", () => {
  afterEach(() => {
    resetStrings();
    resetI18nConfig();
    resetTranslationCache();
  });

  it("tSync() resolves from the requested locale's bundle", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { hello: "Hello" });
    addStrings("ko", { hello: "안녕" });
    expect(tSync("hello", "en")).toBe("Hello");
    expect(tSync("hello", "ko")).toBe("안녕");
  });

  it("preserves prototype-shaped translation keys without changing object prototypes", () => {
    addStrings("en", { ["__proto__"]: "Prototype label", constructor: "Constructor label" });
    const bundle = getStrings("en");
    expect(Object.getPrototypeOf(bundle)).toBeNull();
    expect(bundle.__proto__).toBe("Prototype label");
    expect(bundle.constructor).toBe("Constructor label");
  });

  it("tSync() falls back to the default locale when the requested key is missing", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { byKeyOnly: "English fallback" });
    expect(tSync("byKeyOnly", "ko")).toBe("English fallback");
  });

  it("tSync() falls back to the key itself when no bundle has it (operator-visible miss)", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    expect(tSync("totallyMissingKey", "ko")).toBe("totallyMissingKey");
    expect(tSync("missing.{name}", "ko", { name: "Bae" })).toBe("missing.{name}");
  });

  it("bounds empty effective-bundle snapshots requested for arbitrary canonical locales", () => {
    for (let index = 0; index < 300; index += 1) {
      getStrings(`en-x-${index.toString().padStart(4, "0")}`);
    }
    expect(getI18nRuntimeDiagnostics().effectiveBundleCacheEntries).toBe(256);
  });

  it("tSync() interpolates ICU {name} placeholders from params", () => {
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("en", { greeting: "Hello, {name}!" });
    expect(tSync("greeting", "en", { name: "Bae" })).toBe("Hello, Bae!");
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
    expect(Object.isFrozen(all)).toBe(true);
    expect(Object.isFrozen(all.en)).toBe(true);
    expect(() => {
      (all.en as Record<string, string>).hello = "Mutated";
    }).toThrow();
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

/**
 * Phase 12.7 — ICU MessageFormat features now available
 * through the same `t()` / `tSync()` surface. These tests
 * lock in the contract so a future swap of the formatter
 * library would have to preserve the same behaviors.
 */
describe("ICU MessageFormat (Phase 12.7)", () => {
  afterEach(() => {
    resetStrings();
    resetI18nConfig();
    resetTranslationCache();
  });

  it("plural — English picks the right branch for 0/1/n", () => {
    setI18nConfig({ locales: ["en"], defaultLocale: "en" });
    addStrings("en", {
      "items.count": "{count, plural, =0 {No items} one {1 item} other {# items}}",
    });
    expect(tSync("items.count", "en", { count: 0 })).toBe("No items");
    expect(tSync("items.count", "en", { count: 1 })).toBe("1 item");
    expect(tSync("items.count", "en", { count: 5 })).toBe("5 items");
  });

  it("plural — Korean uses Korean plural rules (everything is 'other')", () => {
    // Korean has no plural distinction; CLDR collapses every
    // count to the `other` category. The formatter should pick
    // up Korean rules from the locale and render the `other`
    // branch even for count=1.
    setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    addStrings("ko", {
      "items.count": "{count, plural, =0 {항목 없음} other {항목 #개}}",
    });
    expect(tSync("items.count", "ko", { count: 0 })).toBe("항목 없음");
    expect(tSync("items.count", "ko", { count: 1 })).toBe("항목 1개");
    expect(tSync("items.count", "ko", { count: 5 })).toBe("항목 5개");
  });

  it("select — branches on a string value", () => {
    setI18nConfig({ locales: ["en"], defaultLocale: "en" });
    addStrings("en", {
      "auth.greeting": "{role, select, admin {Welcome, admin} editor {Hi, editor} other {Hi}}",
    });
    expect(tSync("auth.greeting", "en", { role: "admin" })).toBe("Welcome, admin");
    expect(tSync("auth.greeting", "en", { role: "editor" })).toBe("Hi, editor");
    expect(tSync("auth.greeting", "en", { role: "viewer" })).toBe("Hi");
  });

  it("number — locale-aware grouping separator", () => {
    setI18nConfig({ locales: ["en", "de"], defaultLocale: "en" });
    addStrings("en", { "stats.views": "{n, number} views" });
    addStrings("de", { "stats.views": "{n, number} Aufrufe" });
    expect(tSync("stats.views", "en", { n: 12345 })).toBe("12,345 views");
    // de-DE uses a dot as the thousands separator.
    expect(tSync("stats.views", "de", { n: 12345 })).toBe("12.345 Aufrufe");
  });

  it("plain string with no params and no ICU syntax skips the parser", () => {
    // Smoke test for the fast path. Not directly observable
    // from the outside, but we verify the output matches the
    // input verbatim — including characters that aren't
    // valid ICU literals. (Apostrophes are ICU's escape
    // character, so this would otherwise round-trip differently.)
    setI18nConfig({ locales: ["en"], defaultLocale: "en" });
    addStrings("en", { plain: "It's a plain string" });
    expect(tSync("plain", "en")).toBe("It's a plain string");
  });

  it("rejects malformed ICU templates at registration time", () => {
    setI18nConfig({ locales: ["en"], defaultLocale: "en" });
    expect(() => addStrings("en", { broken: "{count, plural," })).toThrow(/valid ICU/u);
  });

  it("missing param falls back to the raw template instead of crashing", () => {
    setI18nConfig({ locales: ["en"], defaultLocale: "en" });
    addStrings("en", { greet: "Hello, {name}!" });
    // intl-messageformat throws on a missing required
    // placeholder; our `interpolate()` catches that, logs a
    // warn (helps the operator find the missing param), and
    // returns the raw template. Better than rendering a page
    // 500 over a missing variable.
    expect(() => tSync("greet", "en")).not.toThrow();
    expect(tSync("greet", "en")).toBe("Hello, {name}!");
  });

  it("layers plugin strings by load order and removes one plugin cleanly", () => {
    setI18nConfig({ locales: ["en"], defaultLocale: "en" });
    addStrings("en", { shared: "Framework", base: "Base" });
    registerPluginStrings("a", { en: { shared: "Plugin A", a: "A" } });
    registerPluginStrings("b", { en: { shared: "Plugin B", b: "B" } });

    expect(tSync("shared", "en")).toBe("Plugin B");
    expect(getRegisteredPluginStrings()).toHaveLength(4);

    unregisterPluginStrings("b");
    expect(tSync("shared", "en")).toBe("Plugin A");
    expect(getAllStrings().en).toEqual({ shared: "Plugin A", base: "Base", a: "A" });
  });

  it("re-registering a plugin replaces keys it no longer declares", () => {
    registerPluginStrings("a", { en: { stale: "old", current: "v1" } });
    registerPluginStrings("a", { en: { current: "v2" } });
    expect(getAllStrings().en).toEqual({ current: "v2" });
  });

  it("rejects invalid bundles at the direct plugin registry boundary", () => {
    expect(() => registerPluginStrings("broken", { EN: { greeting: "Hello" } })).toThrow(
      /\[plugin:broken\].*canonical BCP 47/u,
    );
    expect(getRegisteredPluginStrings()).toEqual([]);
  });
});

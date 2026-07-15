import { describe, expect, it } from "vitest";

import {
  NpI18nContractError,
  npAnalyzeI18nConfig,
  npAnalyzeI18nStringsResponse,
  npAnalyzeResolveLocaleInput,
  npAnalyzeStringOverrideMutation,
  npAnalyzeStringOverrideRow,
  npAnalyzeTranslationCatalog,
  npAnalyzeTranslationProgressResponse,
  npRequireI18nConfig,
  npRequireI18nConfigResponse,
  npRequireI18nStringsResponse,
  npRequireStringOverrideMutation,
  npRequireTranslationParams,
  npRequireTranslationProgressResponse,
} from "./contract.js";

describe("i18n config contract", () => {
  it("normalizes to an immutable snapshot", () => {
    const locales = ["en", "ko"];
    const value = npRequireI18nConfig({ locales, defaultLocale: "en" });
    locales[0] = "fr";

    expect(value).toEqual({ locales: ["en", "ko"], defaultLocale: "en" });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.locales)).toBe(true);
  });

  it("rejects unknown fields, non-canonical tags, duplicates, and missing defaults", () => {
    const result = npAnalyzeI18nConfig({
      locales: ["en-us", "en-us"],
      defaultLocale: "fr",
      typo: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "unknown-field" }),
          expect.objectContaining({ message: expect.stringContaining("canonical BCP 47") }),
          expect.objectContaining({ code: "duplicate" }),
          expect.objectContaining({ path: "i18n.defaultLocale" }),
        ]),
      );
    }
  });

  it("contains hostile inspection failures instead of invoking accessors", () => {
    let invoked = false;
    const value = Object.defineProperty({}, "locales", {
      enumerable: true,
      get() {
        invoked = true;
        return ["en"];
      },
    });
    const result = npAnalyzeI18nConfig(value);
    expect(result.ok).toBe(false);
    expect(invoked).toBe(false);

    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("trap");
        },
      },
    );
    expect(npAnalyzeI18nConfig(hostile).ok).toBe(false);

    const locales = ["en"];
    Object.defineProperty(locales, 0, {
      enumerable: true,
      get() {
        invoked = true;
        return "en";
      },
    });
    expect(npAnalyzeI18nConfig({ locales, defaultLocale: "en" }).ok).toBe(false);
    expect(invoked).toBe(false);
  });
});

describe("translation and locale input contracts", () => {
  it("accepts canonical ICU catalogs and freezes every bundle", () => {
    const result = npAnalyzeTranslationCatalog({
      en: { greeting: "Hello, {name}!" },
      ko: { greeting: "안녕하세요, {name}!" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.en)).toBe(true);
    }
  });

  it("rejects malformed ICU, unsafe keys, and non-canonical locales", () => {
    const result = npAnalyzeTranslationCatalog({
      "en-us": { " bad ": "{count, plural," },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toMatch(/canonical BCP 47/u);
    }
  });

  it("clones params and rejects non-finite or accessor-backed values", () => {
    const date = new Date("2026-07-15T00:00:00.000Z");
    const params = npRequireTranslationParams({ count: 2, at: date });
    expect(params?.at).not.toBe(date);
    expect(Object.isFrozen(params)).toBe(true);
    expect(() => npRequireTranslationParams({ count: Number.POSITIVE_INFINITY })).toThrow(
      NpI18nContractError,
    );
    expect(() =>
      npRequireTranslationParams(
        Object.defineProperty({}, "name", { enumerable: true, get: () => "unsafe" }),
      ),
    ).toThrow(NpI18nContractError);
  });

  it("requires exact bounded locale-resolution input", () => {
    expect(npAnalyzeResolveLocaleInput({ pathname: "/ko/posts", acceptLanguage: "ko" })).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(npAnalyzeResolveLocaleInput({ pathname: "relative" }).ok).toBe(false);
    expect(npAnalyzeResolveLocaleInput({ pathname: "/", extra: true }).ok).toBe(false);
  });
});

describe("override and Admin wire contracts", () => {
  const userId = "01234567-89ab-4def-8abc-0123456789ab";

  it("requires exact mutation fields and valid ICU values", () => {
    expect(npRequireStringOverrideMutation({ locale: "en", key: "title", value: "Hi" })).toEqual({
      locale: "en",
      key: "title",
      value: "Hi",
    });
    expect(
      npAnalyzeStringOverrideMutation({ locale: "en", key: "title", value: "Hi", extra: true }).ok,
    ).toBe(false);
    expect(
      npAnalyzeStringOverrideMutation({ locale: "en", key: "title", value: "{count, plural," }).ok,
    ).toBe(false);
  });

  it("validates and clones persisted rows", () => {
    const updatedAt = new Date("2026-07-15T00:00:00.000Z");
    const result = npAnalyzeStringOverrideRow({
      siteId: "default",
      locale: "en",
      key: "title",
      value: "Hello",
      updatedAt,
      updatedBy: userId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.updatedAt).not.toBe(updatedAt);
    expect(
      npAnalyzeStringOverrideRow(
        {
          siteId: "default",
          locale: "ko",
          key: "title",
          value: "제목",
          updatedAt,
          updatedBy: null,
        },
        { config: { locales: ["en"], defaultLocale: "en" } },
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeStringOverrideRow(
        {
          siteId: "default",
          locale: "en",
          key: "title",
          value: "Title",
          updatedAt,
          updatedBy: null,
        },
        { config: { locales: ["en-us"], defaultLocale: "en-us" } },
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeStringOverrideRow({
        siteId: "Bad Site",
        locale: "en",
        key: "title",
        value: "Hello",
        updatedAt: new Date("invalid"),
        updatedBy: null,
      }).ok,
    ).toBe(false);
  });

  it("requires exact discriminated config responses", () => {
    expect(npRequireI18nConfigResponse({ enabled: false })).toEqual({ enabled: false });
    expect(() => npRequireI18nConfigResponse({ enabled: false, locales: [] })).toThrow(
      NpI18nContractError,
    );
  });

  it("validates the complete strings response and freezes nested cells", () => {
    const response = npRequireI18nStringsResponse({
      locales: ["en", "ko"],
      defaultLocale: "en",
      siteId: "default",
      keys: [
        {
          key: "title",
          values: {
            en: { base: "Title", override: null },
            ko: { base: "제목", override: "새 제목" },
          },
        },
      ],
    });
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.keys[0]?.values.en)).toBe(true);

    expect(
      npAnalyzeI18nStringsResponse({
        ...response,
        keys: [{ key: "title", values: { en: { base: "Title", override: null } } }],
      }).ok,
    ).toBe(false);
  });

  it("validates and freezes translation-progress responses", () => {
    const response = npRequireTranslationProgressResponse({
      locales: ["en", "ko"],
      defaultLocale: "en",
      collections: [
        {
          collection: "posts",
          totalGroups: 3,
          perLocale: {
            en: { count: 3, missing: 0 },
            ko: { count: 2, missing: 1 },
          },
        },
      ],
    });
    expect(response).not.toBeNull();
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response?.collections[0]?.perLocale.ko)).toBe(true);
    expect(npRequireTranslationProgressResponse(null)).toBeNull();

    expect(
      npAnalyzeTranslationProgressResponse({
        locales: ["en", "ko"],
        defaultLocale: "en",
        collections: [
          {
            collection: "posts",
            totalGroups: 3,
            perLocale: {
              en: { count: 3, missing: 1 },
              fr: { count: 1, missing: 2 },
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });
});

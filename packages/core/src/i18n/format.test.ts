import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatDate,
  formatNumber,
  formatRelativeTime,
  resetIntlFormatterCache,
} from "./format.js";
import { resetI18nConfig, setI18nConfig } from "./registry.js";

beforeEach(() => {
  resetI18nConfig();
  resetIntlFormatterCache();
});
afterEach(() => {
  resetI18nConfig();
  resetIntlFormatterCache();
});

describe("formatNumber", () => {
  it("uses the explicit locale when provided", () => {
    expect(formatNumber(1234.5, "de-DE")).toBe("1.234,5");
    expect(formatNumber(1234.5, "en-US")).toBe("1,234.5");
  });

  it("falls back to the i18n config's defaultLocale when no explicit locale is given", () => {
    setI18nConfig({ locales: ["de-DE", "en"], defaultLocale: "de-DE" });
    expect(formatNumber(1234.5)).toBe("1.234,5");
  });

  it('falls back to "en" when no i18n config is registered', () => {
    expect(formatNumber(1234.5)).toBe("1,234.5");
  });

  it("forwards Intl.NumberFormat options (currency, percent, etc.)", () => {
    expect(
      formatNumber(99.5, "en-US", { style: "currency", currency: "USD" }),
    ).toBe("$99.50");
    expect(
      formatNumber(0.05, "en-US", { style: "percent" }),
    ).toBe("5%");
  });

  it("returns the literal NaN/Infinity rather than a localized version (debuggability)", () => {
    expect(formatNumber(Number.NaN)).toBe("NaN");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("formatDate", () => {
  const ISO = "2026-04-29T12:34:56.000Z";

  it("accepts Date / string / number inputs", () => {
    const stringOut = formatDate(ISO, "en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const dateOut = formatDate(new Date(ISO), "en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const epochOut = formatDate(Date.parse(ISO), "en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(stringOut).toBe("Apr 29, 2026");
    expect(dateOut).toBe("Apr 29, 2026");
    expect(epochOut).toBe("Apr 29, 2026");
  });

  it("respects the resolved locale + options", () => {
    expect(
      formatDate(ISO, "de-DE", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    ).toBe("29.04.2026");
  });

  it("returns an empty string for unparseable inputs", () => {
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate(new Date("invalid"))).toBe("");
  });
});

describe("formatRelativeTime", () => {
  it("emits localized relative phrasing for each unit", () => {
    expect(formatRelativeTime(-2, "day", "en-US")).toBe("2 days ago");
    expect(formatRelativeTime(3, "hour", "en-US")).toBe("in 3 hours");
  });

  it("respects numeric/style options", () => {
    expect(
      formatRelativeTime(-1, "day", "en-US", { numeric: "auto" }),
    ).toBe("yesterday");
  });

  it("returns the literal NaN rather than a formatted Intl error string", () => {
    expect(formatRelativeTime(Number.NaN, "day")).toBe("NaN");
  });
});

describe("formatter cache", () => {
  it("returns the same Intl.NumberFormat instance for repeat (locale, options) calls", () => {
    // The cache is internal but observable via reference: spy on
    // `Intl.NumberFormat` to confirm the constructor only fires once
    // for two calls with the same shape.
    const NumberFormatOriginal = Intl.NumberFormat;
    let constructorCalls = 0;
    const Patched = function (...args: unknown[]) {
      constructorCalls += 1;
      return Reflect.construct(
        NumberFormatOriginal as unknown as new (...a: unknown[]) => Intl.NumberFormat,
        args,
      );
    } as unknown as typeof Intl.NumberFormat;
    Intl.NumberFormat = Patched;
    try {
      resetIntlFormatterCache();
      formatNumber(1, "en-US");
      formatNumber(2, "en-US");
      formatNumber(3, "en-US");
      expect(constructorCalls).toBe(1);
      formatNumber(4, "en-US", { style: "percent" });
      formatNumber(5, "en-US", { style: "percent" });
      expect(constructorCalls).toBe(2);
    } finally {
      Intl.NumberFormat = NumberFormatOriginal;
    }
  });
});

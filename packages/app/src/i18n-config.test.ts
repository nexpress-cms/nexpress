import { describe, expect, it } from "vitest";

import { npRequireI18nConfig } from "@nexpress/core/i18n-contract";

import { defaultI18n } from "./config-defaults/index.js";
import { i18nConfig, isLocale } from "./i18n-config.js";

describe("shared app i18n config", () => {
  it("keeps proxy and generated bootstrap defaults on one exact catalog", () => {
    expect(npRequireI18nConfig(i18nConfig)).toEqual({
      locales: ["en", "ko"],
      defaultLocale: "en",
    });
    expect(defaultI18n).toBe(i18nConfig);
    expect(Object.isFrozen(i18nConfig)).toBe(true);
    expect(Object.isFrozen(i18nConfig.locales)).toBe(true);
  });

  it("derives locale membership from the validated catalog", () => {
    expect(isLocale("ko")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });
});

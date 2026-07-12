import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEO_SETTINGS,
  isNpAdminSettingsSnapshot,
  isNpSiteWireRecord,
  npAnalyzeSettingValue,
  npAnalyzeSiteRuntimeSettings,
  npClassifySettingKey,
  npNormalizeSeoSettings,
  npNormalizeSiteGeneralSettings,
} from "./contract.js";

const general = {
  name: "Acme",
  url: "https://example.com",
  description: "A site",
  defaultLocale: "en-US",
  timezone: "Asia/Seoul",
};

describe("framework settings contract", () => {
  it("normalizes the canonical site identity shape", () => {
    expect(
      npNormalizeSiteGeneralSettings({
        ...general,
        url: "https://example.com/",
        defaultLocale: "en_us",
        timezone: "utc",
      }),
    ).toEqual({ ...general, defaultLocale: "en-US", timezone: "UTC" });
  });

  it("rejects unknown site settings and unsafe origins", () => {
    expect(
      npAnalyzeSiteRuntimeSettings({
        siteUrl: "https://user:secret@example.com/path",
        defaultLocale: null,
        timezone: null,
        typo: true,
      }),
    ).not.toEqual([]);
    expect(
      npAnalyzeSiteRuntimeSettings({
        siteUrl: "https://example.com/",
        defaultLocale: "en_us",
        timezone: "UTC",
      }),
    ).not.toEqual([]);
  });

  it("normalizes exact SEO values and rejects extra fields", () => {
    expect(
      npNormalizeSeoSettings({
        defaultOgImage: "/og.png",
        twitterHandle: "@nexpress",
        defaultLocale: "ko-kr",
      }),
    ).toEqual({
      defaultOgImage: "/og.png",
      twitterHandle: "nexpress",
      defaultLocale: "ko_KR",
    });
    expect(() => npNormalizeSeoSettings({ ...DEFAULT_SEO_SETTINGS, typo: true })).toThrow(
      "unsupported SEO settings field",
    );
    expect(
      npAnalyzeSettingValue("seo", {
        defaultOgImage: null,
        twitterHandle: "@nexpress",
        defaultLocale: "en-US",
      }),
    ).not.toEqual([]);
  });

  it("validates the exact Admin snapshot and site wire record", () => {
    expect(isNpAdminSettingsSnapshot({ site: general, seo: DEFAULT_SEO_SETTINGS })).toBe(true);
    expect(
      isNpSiteWireRecord({
        id: "default",
        name: "Acme",
        hostname: null,
        description: null,
        settings: { siteUrl: null, defaultLocale: null, timezone: null },
        isDefault: true,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("classifies only owned static and dynamic setting keys", () => {
    expect(npClassifySettingKey("seo")).toBe("seo");
    expect(npClassifySettingKey("theme.settings:portfolio")).toBe("theme-settings");
    expect(npClassifySettingKey("plugin.config:analytics-lite")).toBe("plugin-config");
    expect(npClassifySettingKey("site")).toBeNull();
    expect(npClassifySettingKey("arbitrary.key")).toBeNull();
  });

  it("validates every persisted registry family fail-closed", () => {
    expect(npAnalyzeSettingValue("seo", DEFAULT_SEO_SETTINGS)).toEqual([]);
    expect(
      npAnalyzeSettingValue("community", {
        reactionKinds: ["like"],
        registrationEnabled: true,
        memberUploadQuota: { perDay: null, total: null },
      }),
    ).toEqual([]);
    expect(
      npAnalyzeSettingValue("plugin.config:demo", {
        __npVersion: 1,
        __npSettings: { enabled: true },
      }),
    ).toEqual([]);
    expect(npAnalyzeSettingValue("page-builder.patterns", [])).toEqual([]);
    expect(npAnalyzeSettingValue("site", { name: "legacy" })[0]?.code).toBe("unknown-key");
    expect(
      npAnalyzeSettingValue("plugin.config:demo", {
        __npVersion: 1,
        __npSettings: {},
        extra: true,
      })[0]?.code,
    ).toBe("unknown-field");
    expect(npAnalyzeSettingValue("theme", { colors: { accent: "#123456" } })).toEqual([]);
    expect(npAnalyzeSettingValue("activeTheme", "portfolio")).toEqual([]);
    expect(npAnalyzeSettingValue("activeTheme", "Portfolio Theme")).not.toEqual([]);
    expect(
      npAnalyzeSettingValue("theme.settings:portfolio", {
        __npVersion: 2,
        __npSettings: { layout: "wide" },
      }),
    ).toEqual([]);
    expect(
      npAnalyzeSettingValue("jobs.paused", {
        paused: true,
        changedAt: "2026-07-12T00:00:00.000Z",
        changedByUserId: "123e4567-e89b-42d3-a456-426614174000",
        reason: "maintenance",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeSettingValue("jobs.paused", {
        paused: true,
        changedAt: "2026-07-12T00:00:00.000Z",
        changedByUserId: "------------------------------------",
        reason: null,
      }),
    ).not.toEqual([]);
  });
});

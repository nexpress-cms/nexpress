import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEO_SETTINGS,
  DEFAULT_SITE_QUOTAS,
  isNpAdminSettingsSnapshot,
  isNpSiteQuotaSnapshot,
  isNpSiteMembershipWireRecord,
  isNpSiteUsage,
  isNpSiteWireRecord,
  npAnalyzeSiteRecord,
  npAnalyzeSettingRecord,
  npAnalyzeSettingValue,
  npAnalyzeSiteRuntimeSettings,
  npClassifySettingKey,
  npNormalizeCreateSiteInput,
  npNormalizeSeoSettings,
  npNormalizeSiteQuotas,
  npNormalizeSiteHostHeader,
  npNormalizeSiteMembershipGrantInput,
  npNormalizeSiteGeneralSettings,
  npNormalizeUpdateSiteInput,
  npSerializeSiteMembership,
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
    expect(
      npAnalyzeSiteRecord({
        id: "other",
        name: "Other",
        hostname: null,
        description: null,
        settings: { siteUrl: null, defaultLocale: null, timezone: null },
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).not.toEqual([]);
  });

  it("normalizes exact site create/update inputs and rejects extras", () => {
    expect(
      npNormalizeCreateSiteInput({
        id: "acme",
        name: "Acme",
        hostname: "ACME.EXAMPLE.COM.",
      }),
    ).toEqual({
      id: "acme",
      name: "Acme",
      hostname: "acme.example.com",
      description: null,
      settings: { siteUrl: null, defaultLocale: null, timezone: null },
    });
    expect(npNormalizeUpdateSiteInput({ hostname: "LOCALHOST" })).toEqual({
      hostname: "localhost",
    });
    expect(() => npNormalizeCreateSiteInput({ id: "default", name: "Other" })).toThrow("reserved");
    expect(() => npNormalizeUpdateSiteInput({})).toThrow("at least one");
    expect(() => npNormalizeUpdateSiteInput({ name: "Acme", typo: true })).toThrow("unsupported");
    expect(npNormalizeSiteHostHeader("Acme.Example.com:3000")).toBe("acme.example.com");
  });

  it("validates membership inputs, persisted values, and wire serialization", () => {
    const input = npNormalizeSiteMembershipGrantInput({
      userId: "123e4567-e89b-42d3-a456-426614174000",
      role: "moderator",
    });
    expect(input.role).toBe("moderator");
    expect(() =>
      npNormalizeSiteMembershipGrantInput({ ...input, role: "owner", extra: true }),
    ).toThrow("unsupported");
    const wire = npSerializeSiteMembership({
      siteId: "default",
      ...input,
      createdAt: new Date("2026-07-13T00:00:00.000Z"),
      updatedAt: new Date("2026-07-13T00:00:00.000Z"),
    });
    expect(isNpSiteMembershipWireRecord(wire)).toBe(true);
    expect(isNpSiteMembershipWireRecord({ ...wire, role: "owner" })).toBe(false);
  });

  it("validates exact site usage totals", () => {
    const usage = {
      collections: { posts: 2 },
      settings: 1,
      navigation: 0,
      slugHistory: 0,
      memberships: 0,
      stringOverrides: 0,
      pluginStorage: 0,
      media: 0,
      mediaFolders: 0,
      mediaRefs: 0,
      comments: 0,
      contentViews: 0,
      reactions: 0,
      follows: 0,
      mutes: 0,
      notifications: 0,
      reports: 0,
      auditEvents: 0,
      bans: 0,
      memberRoles: 0,
      total: 3,
    };
    expect(isNpSiteUsage(usage)).toBe(true);
    expect(isNpSiteUsage({ ...usage, total: 2 })).toBe(false);
    expect(isNpSiteUsage({ ...usage, extra: 0 })).toBe(false);
  });

  it("validates exact site quota limits and derived snapshots", () => {
    const limits = {
      storageBytes: 10_000,
      documents: 20,
      jobEnqueuesPerHour: 3,
    };
    expect(npNormalizeSiteQuotas(limits)).toEqual(limits);
    expect(npNormalizeSiteQuotas(DEFAULT_SITE_QUOTAS)).toEqual(DEFAULT_SITE_QUOTAS);
    expect(() => npNormalizeSiteQuotas({ ...limits, documents: -1 })).toThrow("documents");
    expect(() => npNormalizeSiteQuotas({ ...limits, extra: null })).toThrow("extra");
    expect(
      isNpSiteQuotaSnapshot({
        limits,
        usage: { storageBytes: 12_000, documents: 20, jobEnqueuesLastHour: null },
        exceeded: ["storageBytes"],
        unavailable: ["jobEnqueuesPerHour"],
      }),
    ).toBe(true);
    expect(
      isNpSiteQuotaSnapshot({
        limits,
        usage: { storageBytes: 12_000, documents: 20, jobEnqueuesLastHour: null },
        exceeded: [],
        unavailable: [],
      }),
    ).toBe(false);
  });

  it("classifies only owned static and dynamic setting keys", () => {
    expect(npClassifySettingKey("seo")).toBe("seo");
    expect(npClassifySettingKey("site.quotas")).toBe("site-quotas");
    expect(npClassifySettingKey("theme.settings:portfolio")).toBe("theme-settings");
    expect(npClassifySettingKey("plugin.config:analytics-lite")).toBe("plugin-config");
    expect(npClassifySettingKey("plugin.config:@acme/analytics_lite")).toBe("plugin-config");
    expect(npClassifySettingKey("theme.settings:@acme/portfolio")).toBeNull();
    expect(npClassifySettingKey("site")).toBeNull();
    expect(npClassifySettingKey("arbitrary.key")).toBeNull();
  });

  it("validates every persisted registry family fail-closed", () => {
    expect(npAnalyzeSettingValue("seo", DEFAULT_SEO_SETTINGS)).toEqual([]);
    expect(npAnalyzeSettingValue("site.quotas", DEFAULT_SITE_QUOTAS)).toEqual([]);
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
    expect(
      npAnalyzeSettingValue("plugin.config:demo", {
        __npVersion: 1,
        __npSettings: { oversized: "x".repeat(1_000_001) },
      }),
    ).not.toEqual([]);
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

  it("enforces global versus site-scoped setting ownership", () => {
    const paused = {
      paused: false,
      changedAt: "2026-07-12T00:00:00.000Z",
      changedByUserId: null,
      reason: null,
    };
    expect(npAnalyzeSettingRecord("_system", "jobs.paused", paused)).toEqual([]);
    expect(npAnalyzeSettingRecord("default", "jobs.paused", paused)).not.toEqual([]);
    expect(npAnalyzeSettingRecord("_system", "seo", DEFAULT_SEO_SETTINGS)).not.toEqual([]);
  });
});

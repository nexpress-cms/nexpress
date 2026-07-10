import { describe, expect, it } from "vitest";

import {
  analyticsLitePlugin,
  createAnalyticsRenderContribution,
  normalizeEvent,
  previousUtcDay,
  rollupEvents,
  type AnalyticsLiteConfig,
} from "./index.js";

const analyticsConfig: AnalyticsLiteConfig = {
  enabled: true,
  respectDoNotTrack: true,
  sampleRate: 1,
  scriptPath: "/api/plugins/analytics-lite/event",
  retentionDays: 90,
};

describe("analytics-lite", () => {
  it("normalizes sparse event payloads", () => {
    expect(normalizeEvent({})).toMatchObject({
      path: "/",
      referrer: null,
      title: null,
    });
  });

  it("rolls up top paths and referrers", () => {
    const events = [
      normalizeEvent({ path: "/pricing", referrer: "https://example.com" }),
      normalizeEvent({ path: "/pricing" }),
      normalizeEvent({ path: "/docs", referrer: "https://example.com" }),
    ];

    expect(rollupEvents(events)).toEqual({
      views: 3,
      topPaths: [
        { path: "/pricing", views: 2 },
        { path: "/docs", views: 1 },
      ],
      referrers: [{ referrer: "https://example.com", views: 2 }],
    });
  });

  it("targets the previous UTC day for scheduled rollups", () => {
    expect(previousUtcDay(new Date("2026-03-01T00:05:00.000Z")).toISOString()).toBe(
      "2026-02-28T00:05:00.000Z",
    );
  });

  it("registers the canonical render hook and emits the body-end collector", () => {
    expect(Object.keys(analyticsLitePlugin.hooks ?? {})).toContain("render:beforePage");
    expect(Object.keys(analyticsLitePlugin.hooks ?? {})).not.toContain("render:afterPage");

    const contribution = createAnalyticsRenderContribution(analyticsConfig);
    expect(contribution?.head).toBeUndefined();
    expect(contribution?.bodyEnd).toHaveLength(1);
    expect(contribution?.bodyEnd?.[0]).toMatchObject({ tag: "script" });
    expect(contribution?.bodyEnd?.[0]?.children).toContain(analyticsConfig.scriptPath);
    expect(contribution?.bodyEnd?.[0]?.children).toContain("navigator.doNotTrack");
  });

  it("does not contribute a collector when analytics is disabled", () => {
    expect(
      createAnalyticsRenderContribution({ ...analyticsConfig, enabled: false }),
    ).toBeUndefined();
  });

  it("declares the admin action id and kind inventory", () => {
    expect(
      Object.entries(analyticsLitePlugin.actions ?? {}).map(([id, action]) => ({
        id,
        kind: action.kind,
      })),
    ).toEqual([
      { id: "todayViews", kind: "metric" },
      { id: "topPaths", kind: "table" },
    ]);
  });
});

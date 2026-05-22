import { describe, expect, it } from "vitest";

import { normalizeEvent, rollupEvents } from "./index.js";

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
});

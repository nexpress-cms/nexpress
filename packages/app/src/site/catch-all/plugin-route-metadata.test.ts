import { describe, expect, it } from "vitest";

import { npApplyPluginPageRouteLocaleMetadata } from "./plugin-route-metadata";

describe("plugin page route locale metadata", () => {
  it("adds automatic language alternates for locale=auto", () => {
    expect(
      npApplyPluginPageRouteLocaleMetadata(
        { title: "Events", alternates: { canonical: "/events" } },
        "auto",
        { en: "/en/events", ko: "/ko/events" },
        "/events",
      ),
    ).toEqual({
      title: "Events",
      alternates: {
        canonical: "/events",
        languages: { en: "/en/events", ko: "/ko/events", "x-default": "/events" },
      },
    });
  });

  it("leaves author metadata untouched for locale=none", () => {
    const metadata = {
      title: "Callback",
      alternates: { languages: { callback: "/callback" } },
    };
    expect(
      npApplyPluginPageRouteLocaleMetadata(metadata, "none", { en: "/en/callback" }, "/callback"),
    ).toBe(metadata);
  });
});

import { describe, expect, it } from "vitest";

import {
  nxAdminActionSchema,
  nxAdminDashboardWidgetSchema,
  nxAdminExtensionSchema,
  nxAdminSettingsSchema,
  nxAdminTableSchema,
  nxAdminWidgetSchema,
  nxCollectionTabSchema,
} from "./manifest.js";

describe("nxAdminSettingsSchema", () => {
  it("accepts a minimal settings block", () => {
    expect(() =>
      nxAdminSettingsSchema.parse({
        fields: [{ type: "text", name: "foo" }],
      }),
    ).not.toThrow();
  });

  it("requires at least one field", () => {
    expect(() => nxAdminSettingsSchema.parse({ fields: [] })).toThrow();
  });
});

describe("nxAdminWidgetSchema", () => {
  it("accepts metric + status kinds", () => {
    expect(() =>
      nxAdminWidgetSchema.parse({
        id: "a",
        label: "Quota",
        kind: "metric",
        actionId: "getQuota",
      }),
    ).not.toThrow();
    expect(() =>
      nxAdminWidgetSchema.parse({
        id: "b",
        label: "Health",
        kind: "status",
        actionId: "healthCheck",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      nxAdminWidgetSchema.parse({
        id: "a",
        label: "Quota",
        kind: "graph",
        actionId: "x",
      }),
    ).toThrow();
  });

  it("requires a non-empty actionId", () => {
    expect(() =>
      nxAdminWidgetSchema.parse({
        id: "a",
        label: "Quota",
        kind: "metric",
        actionId: "",
      }),
    ).toThrow();
  });
});

describe("nxAdminActionSchema", () => {
  it("accepts a minimal action", () => {
    expect(() =>
      nxAdminActionSchema.parse({
        id: "resync",
        label: "Resync",
        actionId: "fullResync",
      }),
    ).not.toThrow();
  });

  it("accepts optional confirm + description", () => {
    expect(() =>
      nxAdminActionSchema.parse({
        id: "resync",
        label: "Resync",
        actionId: "fullResync",
        confirm: "Sure?",
        description: "Replays every post",
      }),
    ).not.toThrow();
  });
});

describe("nxAdminTableSchema", () => {
  it("requires at least one column", () => {
    expect(() =>
      nxAdminTableSchema.parse({
        id: "t",
        label: "Things",
        columns: [],
        rowsActionId: "list",
      }),
    ).toThrow();
  });

  it("accepts a valid table", () => {
    expect(() =>
      nxAdminTableSchema.parse({
        id: "t",
        label: "Things",
        columns: [{ name: "a", label: "A" }],
        rowsActionId: "list",
      }),
    ).not.toThrow();
  });
});

describe("nxAdminExtensionSchema", () => {
  it("all sections are optional", () => {
    expect(() => nxAdminExtensionSchema.parse({})).not.toThrow();
  });

  it("combines settings + widgets + actions + tables", () => {
    expect(() =>
      nxAdminExtensionSchema.parse({
        settings: { fields: [{ type: "text", name: "x" }] },
        widgets: [{ id: "w", label: "W", kind: "metric", actionId: "a" }],
        actions: [{ id: "a", label: "A", actionId: "doIt" }],
        tables: [
          { id: "t", label: "T", columns: [{ name: "c", label: "C" }], rowsActionId: "rows" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects malformed widget entries", () => {
    expect(() =>
      nxAdminExtensionSchema.parse({
        widgets: [{ id: "", label: "W", kind: "metric", actionId: "x" }],
      }),
    ).toThrow();
  });
});

describe("nxCollectionTabSchema", () => {
  it("accepts a tab scoped to a specific collection with at least one widget", () => {
    expect(() =>
      nxCollectionTabSchema.parse({
        id: "seo",
        label: "SEO",
        collections: ["posts"],
        widgets: [{ id: "score", label: "Score", kind: "metric", actionId: "getScore" }],
      }),
    ).not.toThrow();
  });

  it("accepts `*` as a match-any-collection token", () => {
    expect(() =>
      nxCollectionTabSchema.parse({
        id: "readingTime",
        label: "Reading time",
        collections: "*",
        widgets: [
          { id: "wc", label: "Words", kind: "metric", actionId: "countWords" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects an empty collections array", () => {
    expect(() =>
      nxCollectionTabSchema.parse({
        id: "x",
        label: "X",
        collections: [],
        actions: [{ id: "a", label: "A", actionId: "z" }],
      }),
    ).toThrow();
  });

  it("rejects tabs with neither widgets nor actions", () => {
    expect(() =>
      nxCollectionTabSchema.parse({
        id: "empty",
        label: "Empty",
        collections: "*",
      }),
    ).toThrow(/widget or action/);
  });

  it("nxAdminExtensionSchema accepts collectionTabs alongside other sections", () => {
    expect(() =>
      nxAdminExtensionSchema.parse({
        widgets: [{ id: "w", label: "W", kind: "metric", actionId: "a" }],
        collectionTabs: [
          {
            id: "seo",
            label: "SEO",
            collections: ["posts"],
            widgets: [{ id: "score", label: "Score", kind: "metric", actionId: "getScore" }],
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe("nxAdminDashboardWidgetSchema", () => {
  it("accepts a widget with an optional priority", () => {
    expect(() =>
      nxAdminDashboardWidgetSchema.parse({
        id: "quota",
        label: "Quota",
        kind: "metric",
        actionId: "getQuota",
        priority: 10,
      }),
    ).not.toThrow();
  });

  it("rejects a non-integer priority", () => {
    expect(() =>
      nxAdminDashboardWidgetSchema.parse({
        id: "quota",
        label: "Quota",
        kind: "metric",
        actionId: "getQuota",
        priority: 1.5,
      }),
    ).toThrow();
  });

  it("nxAdminExtensionSchema accepts dashboardWidgets", () => {
    expect(() =>
      nxAdminExtensionSchema.parse({
        dashboardWidgets: [
          { id: "q", label: "Q", kind: "metric", actionId: "getQuota" },
        ],
      }),
    ).not.toThrow();
  });
});

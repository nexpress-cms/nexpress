import { describe, expect, it } from "vitest";

import {
  npAdminActionSchema,
  npAdminDashboardWidgetSchema,
  npAdminExtensionSchema,
  npAdminSettingsSchema,
  npAdminTableSchema,
  npAdminWidgetSchema,
  npCollectionTabSchema,
} from "./manifest.js";

describe("npAdminSettingsSchema", () => {
  it("accepts a minimal settings block", () => {
    expect(() =>
      npAdminSettingsSchema.parse({
        fields: [{ type: "text", name: "foo" }],
      }),
    ).not.toThrow();
  });

  it("requires at least one field", () => {
    expect(() => npAdminSettingsSchema.parse({ fields: [] })).toThrow();
  });
});

describe("npAdminWidgetSchema", () => {
  it("accepts metric + status kinds", () => {
    expect(() =>
      npAdminWidgetSchema.parse({
        id: "a",
        label: "Quota",
        kind: "metric",
        actionId: "getQuota",
      }),
    ).not.toThrow();
    expect(() =>
      npAdminWidgetSchema.parse({
        id: "b",
        label: "Health",
        kind: "status",
        actionId: "healthCheck",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      npAdminWidgetSchema.parse({
        id: "a",
        label: "Quota",
        kind: "graph",
        actionId: "x",
      }),
    ).toThrow();
  });

  it("requires a non-empty actionId", () => {
    expect(() =>
      npAdminWidgetSchema.parse({
        id: "a",
        label: "Quota",
        kind: "metric",
        actionId: "",
      }),
    ).toThrow();
  });
});

describe("npAdminActionSchema", () => {
  it("accepts a minimal action", () => {
    expect(() =>
      npAdminActionSchema.parse({
        id: "resync",
        label: "Resync",
        actionId: "fullResync",
      }),
    ).not.toThrow();
  });

  it("accepts optional confirm + description", () => {
    expect(() =>
      npAdminActionSchema.parse({
        id: "resync",
        label: "Resync",
        actionId: "fullResync",
        confirm: "Sure?",
        description: "Replays every post",
      }),
    ).not.toThrow();
  });
});

describe("npAdminTableSchema", () => {
  it("requires at least one column", () => {
    expect(() =>
      npAdminTableSchema.parse({
        id: "t",
        label: "Things",
        columns: [],
        rowsActionId: "list",
      }),
    ).toThrow();
  });

  it("accepts a valid table", () => {
    expect(() =>
      npAdminTableSchema.parse({
        id: "t",
        label: "Things",
        columns: [{ name: "a", label: "A" }],
        rowsActionId: "list",
      }),
    ).not.toThrow();
  });
});

describe("npAdminExtensionSchema", () => {
  it("all sections are optional", () => {
    expect(() => npAdminExtensionSchema.parse({})).not.toThrow();
  });

  it("combines settings + widgets + actions + tables", () => {
    expect(() =>
      npAdminExtensionSchema.parse({
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
      npAdminExtensionSchema.parse({
        widgets: [{ id: "", label: "W", kind: "metric", actionId: "x" }],
      }),
    ).toThrow();
  });
});

describe("npCollectionTabSchema", () => {
  it("accepts a tab scoped to a specific collection with at least one widget", () => {
    expect(() =>
      npCollectionTabSchema.parse({
        id: "seo",
        label: "SEO",
        collections: ["posts"],
        widgets: [{ id: "score", label: "Score", kind: "metric", actionId: "getScore" }],
      }),
    ).not.toThrow();
  });

  it("accepts `*` as a match-any-collection token", () => {
    expect(() =>
      npCollectionTabSchema.parse({
        id: "readingTime",
        label: "Reading time",
        collections: "*",
        widgets: [{ id: "wc", label: "Words", kind: "metric", actionId: "countWords" }],
      }),
    ).not.toThrow();
  });

  it("rejects an empty collections array", () => {
    expect(() =>
      npCollectionTabSchema.parse({
        id: "x",
        label: "X",
        collections: [],
        actions: [{ id: "a", label: "A", actionId: "z" }],
      }),
    ).toThrow();
  });

  it("rejects tabs with neither widgets nor actions", () => {
    expect(() =>
      npCollectionTabSchema.parse({
        id: "empty",
        label: "Empty",
        collections: "*",
      }),
    ).toThrow(/widget or action/);
  });

  it("npAdminExtensionSchema accepts collectionTabs alongside other sections", () => {
    expect(() =>
      npAdminExtensionSchema.parse({
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

describe("npAdminDashboardWidgetSchema", () => {
  it("accepts a widget with an optional priority", () => {
    expect(() =>
      npAdminDashboardWidgetSchema.parse({
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
      npAdminDashboardWidgetSchema.parse({
        id: "quota",
        label: "Quota",
        kind: "metric",
        actionId: "getQuota",
        priority: 1.5,
      }),
    ).toThrow();
  });

  it("npAdminExtensionSchema accepts dashboardWidgets", () => {
    expect(() =>
      npAdminExtensionSchema.parse({
        dashboardWidgets: [{ id: "q", label: "Q", kind: "metric", actionId: "getQuota" }],
      }),
    ).not.toThrow();
  });
});

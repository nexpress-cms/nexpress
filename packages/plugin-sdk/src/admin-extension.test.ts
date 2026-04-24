import { describe, expect, it } from "vitest";

import {
  nxAdminActionSchema,
  nxAdminExtensionSchema,
  nxAdminSettingsSchema,
  nxAdminTableSchema,
  nxAdminWidgetSchema,
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

import { describe, expect, it } from "vitest";

import {
  npAnalyzePluginAdminActionContract,
  npCollectPluginAdminActionReferences,
  npValidatePluginActionResult,
  type NpRegisteredPluginAction,
} from "./admin-action-contract.js";

const admin = {
  widgets: [
    { id: "quota", label: "Quota", kind: "metric", actionId: "quota" },
    { id: "health", label: "Health", kind: "status", actionId: "health" },
  ],
  actions: [{ id: "refresh", label: "Refresh", actionId: "health" }],
  tables: [
    {
      id: "rows",
      label: "Rows",
      columns: [{ name: "id", label: "ID" }],
      rowsActionId: "rows",
    },
  ],
  collectionTabs: [
    {
      id: "document",
      collections: ["posts"],
      widgets: [{ id: "score", label: "Score", kind: "metric", actionId: "score" }],
    },
  ],
  dashboardWidgets: [{ id: "dashboard", label: "Dashboard", kind: "metric", actionId: "quota" }],
};

function action(
  id: string,
  kind: NpRegisteredPluginAction["kind"],
  source: NpRegisteredPluginAction["source"] = "definition",
): NpRegisteredPluginAction {
  return { id, kind, source };
}

describe("npCollectPluginAdminActionReferences", () => {
  it("collects plugin, table, collection-tab, and dashboard consumers", () => {
    expect(npCollectPluginAdminActionReferences(admin)).toEqual([
      { actionId: "quota", expectedKind: "metric", location: "admin.widgets.quota" },
      { actionId: "health", expectedKind: "status", location: "admin.widgets.health" },
      { actionId: "health", expectedKind: null, location: "admin.actions.refresh" },
      { actionId: "rows", expectedKind: "table", location: "admin.tables.rows" },
      {
        actionId: "score",
        expectedKind: "metric",
        location: "admin.collectionTabs.document.widgets.score",
      },
      {
        actionId: "quota",
        expectedKind: "metric",
        location: "admin.dashboardWidgets.dashboard",
      },
    ]);
  });
});

describe("npAnalyzePluginAdminActionContract", () => {
  it("accepts compatible kinds and lets buttons share typed handlers", () => {
    expect(
      npAnalyzePluginAdminActionContract(admin, [
        action("quota", "metric"),
        action("health", "status"),
        action("rows", "table"),
        action("score", "metric"),
      ]),
    ).toEqual([]);
  });

  it("reports missing, mismatched, untyped, and unused actions", () => {
    const issues = npAnalyzePluginAdminActionContract(admin, [
      action("quota", "status"),
      action("health", "action", "setup"),
      action("rows", "table"),
      action("orphan", "action"),
    ]);

    expect(issues.map((issue) => [issue.code, issue.actionId])).toEqual([
      ["kind-mismatch", "quota"],
      ["untyped", "health"],
      ["missing", "score"],
      ["unused", "orphan"],
    ]);
  });

  it("reports one conflict when an id is consumed as multiple typed kinds", () => {
    const issues = npAnalyzePluginAdminActionContract(
      {
        widgets: [
          { id: "metric", kind: "metric", actionId: "shared" },
          { id: "status", kind: "status", actionId: "shared" },
        ],
      },
      [action("shared", "metric")],
    );

    expect(issues.some((issue) => issue.code === "conflicting-references")).toBe(true);
  });

  it("rejects dot-segment ids even when a runtime action is registered", () => {
    expect(
      npAnalyzePluginAdminActionContract({ actions: [{ id: "sync", actionId: ".." }] }, [
        action("..", "action", "setup"),
      ]),
    ).toEqual([
      expect.objectContaining({
        code: "unsafe-id",
        severity: "error",
        actionId: "..",
        locations: ["admin.actions.sync"],
      }),
    ]);
  });
});

describe("npValidatePluginActionResult", () => {
  it("accepts each typed result shape", () => {
    expect(
      npValidatePluginActionResult("demo", "metric", "metric", {
        ok: true,
        data: { value: 1, delta: "+1" },
      }),
    ).toEqual({ ok: true, data: { value: 1, delta: "+1" } });
    expect(
      npValidatePluginActionResult("demo", "status", "status", {
        ok: true,
        data: { level: "ok", message: "Healthy" },
      }),
    ).toEqual({ ok: true, data: { level: "ok", message: "Healthy" } });
    expect(
      npValidatePluginActionResult("demo", "table", "table", {
        ok: true,
        data: { rows: [{ id: "1" }], total: 1 },
      }),
    ).toEqual({ ok: true, data: { rows: [{ id: "1" }], total: 1 } });
  });

  it("preserves valid envelopes for backward-compatible inter-plugin dispatch", () => {
    const result = {
      ok: true,
      data: { value: 1 },
      error: "advisory",
      metadata: { cached: true },
    };

    expect(npValidatePluginActionResult("demo", "metric", "metric", result)).toBe(result);
  });

  it("turns malformed typed data into an explicit action error", () => {
    expect(
      npValidatePluginActionResult("demo", "metric", "metric", {
        ok: true,
        data: { level: "ok" },
      }),
    ).toEqual({
      ok: false,
      error:
        '[plugin:demo] action "metric" returned an invalid result: metric data.value must be a string or number',
    });
    expect(
      npValidatePluginActionResult("demo", "table", "table", {
        ok: true,
        data: { rows: [null], total: 1 },
      }),
    ).toEqual({
      ok: false,
      error:
        '[plugin:demo] action "table" returned an invalid result: table data.rows must contain objects',
    });
    expect(
      npValidatePluginActionResult("demo", "metric", "metric", {
        ok: true,
        data: { value: Number.POSITIVE_INFINITY },
      }),
    ).toEqual({
      ok: false,
      error:
        '[plugin:demo] action "metric" returned an invalid result: metric data.value must be finite',
    });
  });
});

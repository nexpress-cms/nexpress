import { afterEach, describe, expect, it, vi } from "vitest";

import {
  npBuildTableRowActionPayload,
  npBuildTableRowDownloadHref,
  npIsTableRowActionVisible,
} from "./plugin-admin-page.js";
import { getPluginConfigDefaultValues, savePluginConfig } from "./plugin-config.js";
import { npFetch } from "../lib/api-client.js";

vi.mock("../lib/api-client.js", () => ({ npFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe("plugin config forms", () => {
  it("fills only absent values and retains persisted config outside the form", () => {
    const initialConfig = { enabled: false, label: null, empty: "", extra: { nested: true } };
    expect(
      getPluginConfigDefaultValues(
        [
          { type: "checkbox", name: "enabled", defaultValue: true },
          { type: "text", name: "label", defaultValue: "Default" },
          { type: "text", name: "empty", defaultValue: "Default" },
          { type: "number", name: "limit", defaultValue: 12 },
          { type: "row", fields: [{ type: "text", name: "nested", defaultValue: "Default" }] },
        ],
        initialConfig,
      ),
    ).toEqual({ ...initialConfig, limit: 12 });
    expect(initialConfig).not.toHaveProperty("limit");
  });

  it("saves the exact config envelope through shared fetch without requiring a response body", async () => {
    vi.mocked(npFetch).mockResolvedValue(new Response(null, { status: 204 }));
    const value = { enabled: false, label: "", extra: { nested: true } };
    await expect(savePluginConfig("vendor/plugin", value, "Save failed.")).resolves.toBeUndefined();
    expect(npFetch).toHaveBeenCalledWith("/api/admin/plugins/vendor%2Fplugin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  });

  it("reports server errors and safely falls back for malformed error responses", async () => {
    for (const response of [
      Response.json({ error: { message: { private: "diagnostic" } } }, { status: 400 }),
      new Response("upstream error", { status: 502 }),
    ]) {
      vi.mocked(npFetch).mockResolvedValueOnce(response);
      await expect(savePluginConfig("plugin", {}, "Save failed.")).rejects.toThrow("Save failed.");
    }
    vi.mocked(npFetch).mockResolvedValueOnce(
      Response.json({ error: { message: "Invalid config." } }, { status: 400 }),
    );
    await expect(savePluginConfig("plugin", {}, "Save failed.")).rejects.toThrow("Invalid config.");
    vi.mocked(npFetch).mockRejectedValueOnce(new Error("Network unavailable."));
    await expect(savePluginConfig("plugin", {}, "Save failed.")).rejects.toThrow(
      "Network unavailable.",
    );
  });
});

const action = {
  id: "ship",
  label: "Ship",
  actionId: "shipOrder",
  rowFields: ["id", "revision"],
  visibleWhen: { field: "status", oneOf: ["awaiting", "processing"] },
};

describe("plugin Admin table row actions", () => {
  it("uses strict primitive matching for presentation visibility", () => {
    expect(npIsTableRowActionVisible(action, { status: "awaiting" })).toBe(true);
    expect(npIsTableRowActionVisible(action, { status: "shipped" })).toBe(false);
    expect(
      npIsTableRowActionVisible(
        { ...action, visibleWhen: { field: "revision", oneOf: [1] } },
        { revision: "1" },
      ),
    ).toBe(false);
  });

  it("copies only declared row fields into the action payload", () => {
    const values = { carrier: "Parcel Co" };
    expect(
      npBuildTableRowActionPayload(
        action,
        { id: "order-1", revision: 3, privateEmail: "must-not-leak@example.com" },
        values,
      ),
    ).toEqual({ row: { id: "order-1", revision: 3 }, values });
  });

  it("builds same-origin download URLs only from declared primitive row fields", () => {
    const download = {
      type: "download" as const,
      id: "label",
      label: "Label",
      routePath: "/carrier/shipping-label",
      query: [
        { name: "orderId", rowField: "id" },
        { name: "revision", rowField: "revision" },
      ],
    };
    expect(
      npBuildTableRowDownloadHref("shop", download, {
        id: "order/1",
        revision: 3,
        privateEmail: "must-not-leak@example.com",
      }),
    ).toBe("/api/plugins/shop/carrier/shipping-label?orderId=order%2F1&revision=3");
    expect(npBuildTableRowDownloadHref("shop", download, { id: "order-1", revision: null })).toBe(
      null,
    );
  });
});

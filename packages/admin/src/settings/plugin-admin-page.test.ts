import { describe, expect, it } from "vitest";

import {
  npBuildTableRowActionPayload,
  npBuildTableRowDownloadHref,
  npIsTableRowActionVisible,
} from "./plugin-admin-page.js";

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

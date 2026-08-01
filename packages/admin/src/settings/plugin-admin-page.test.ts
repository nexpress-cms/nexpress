import { describe, expect, it } from "vitest";

import { npBuildTableRowActionPayload, npIsTableRowActionVisible } from "./plugin-admin-page.js";

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
});

import { describe, expect, it } from "vitest";

import {
  NP_SHOP_RETURN_STORAGE_CONTRACT,
  npAnalyzeShopReturn,
  npAnalyzeStoredShopReturn,
  npProjectShopReturn,
  npRequireShopReturnApproveInput,
  npRequireShopReturnRejectInput,
  npRequireShopReturnRequestInput,
  type NpShopStoredReturn,
} from "./return-contract.js";

const storedReturn: NpShopStoredReturn = {
  contract: NP_SHOP_RETURN_STORAGE_CONTRACT,
  id: "323e4567-e89b-42d3-a456-426614174000",
  orderId: "123e4567-e89b-42d3-a456-426614174000",
  ownerSegment: `guest:${"a".repeat(64)}`,
  status: "approved",
  revision: 2,
  orderRevision: 4,
  lines: [{ lineKey: "product:variant", quantity: 1 }],
  reason: "defective",
  detail: "Item does not power on",
  operatorNote: "Receive at warehouse A",
  inventoryOutcome: "pending",
  requestedAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:05:00.000Z",
  decidedAt: "2026-08-01T00:05:00.000Z",
  receivedAt: null,
  purgeAt: "2027-07-31T00:00:00.000Z",
};

describe("Shop return contract", () => {
  it("accepts an exact approved return and owner-safe projection", () => {
    expect(npAnalyzeStoredShopReturn(storedReturn)).toEqual([]);
    const projected = npProjectShopReturn(storedReturn);
    expect(projected).not.toHaveProperty("ownerSegment");
    expect(projected).not.toHaveProperty("operatorNote");
    expect(npAnalyzeShopReturn(projected)).toEqual([]);
  });

  it("rejects duplicate lines and inconsistent terminal inventory", () => {
    expect(
      npAnalyzeStoredShopReturn({
        ...storedReturn,
        status: "received",
        lines: [storedReturn.lines[0], storedReturn.lines[0]],
        inventoryOutcome: "pending",
        receivedAt: "2026-08-01T00:06:00.000Z",
        unexpected: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        "return.unexpected is not supported.",
        "return.lines[1].lineKey is duplicated.",
        "received returns require terminal inventory and decision timestamps.",
      ]),
    );
    expect(
      npAnalyzeShopReturn({
        ...npProjectShopReturn(storedReturn),
        updatedAt: "2025-08-01T00:05:00.000Z",
        decidedAt: "2025-08-01T00:05:00.000Z",
      }),
    ).toEqual(
      expect.arrayContaining([
        "return.updatedAt cannot precede requestedAt.",
        "return.decidedAt cannot precede requestedAt.",
      ]),
    );
  });

  it("validates owner and generic Admin inputs exactly", () => {
    expect(
      npRequireShopReturnRequestInput({
        orderId: storedReturn.orderId,
        expectedOrderRevision: 4,
        lines: [{ lineKey: "product:variant", quantity: 1 }],
        reason: "defective",
        detail: null,
      }),
    ).toMatchObject({ reason: "defective", expectedOrderRevision: 4 });
    expect(
      npRequireShopReturnApproveInput({
        row: { id: storedReturn.orderId, returnRevision: 1 },
        values: { operatorNote: "" },
      }),
    ).toEqual({ orderId: storedReturn.orderId, expectedRevision: 1, operatorNote: null });
    expect(() =>
      npRequireShopReturnRejectInput({
        row: { id: storedReturn.orderId, returnRevision: 1 },
        values: { operatorNote: "" },
      }),
    ).toThrow(/Invalid Shop return staff action/u);
    expect(() =>
      npRequireShopReturnRequestInput({
        orderId: storedReturn.orderId,
        expectedOrderRevision: 4,
        lines: [{ lineKey: "product:variant", quantity: 2 }],
        reason: "custom-reason",
        detail: null,
      }),
    ).toThrow(/Invalid Shop return request/u);
  });
});

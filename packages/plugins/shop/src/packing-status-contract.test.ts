import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PACKING_STATUS_EVENT_CONTRACT,
  NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT,
  NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT,
  NpShopPackingStatusContractError,
  npAnalyzeStoredShopPackingStatus,
  npAnalyzeStoredShopPackingStatusReceipt,
  npRequireFreshShopPackingStatusEvent,
  npShopPackingStatusEventDigest,
  npShopPackingStatusReceiptStorageKey,
  npShopPackingStatusStorageKey,
} from "./packing-status-contract.js";

const now = new Date("2026-08-13T12:00:00.000Z");
const event = {
  contract: NP_SHOP_PACKING_STATUS_EVENT_CONTRACT,
  eventId: "packing_evt_123",
  workId: "123e4567-e89b-42d3-a456-426614174000",
  orderId: "123e4567-e89b-42d3-a456-426614174001",
  target: "outbound",
  exchangeId: null,
  providerWorkReference: "wms-work-123",
  status: "picking",
  occurredAt: "2026-08-13T11:55:00.000Z",
  signedAt: now.toISOString(),
} as const;

describe("Shop packing status callback contract", () => {
  it("accepts one exact fresh PII-free outbound or replacement event", () => {
    expect(npRequireFreshShopPackingStatusEvent(event, now)).toEqual(event);
    expect(
      npRequireFreshShopPackingStatusEvent(
        {
          ...event,
          target: "replacement",
          exchangeId: "123e4567-e89b-42d3-a456-426614174002",
          status: "packed",
        },
        now,
      ),
    ).toMatchObject({ target: "replacement", status: "packed" });
  });

  it("rejects replayed, delayed, extended, and cross-target events", () => {
    for (const [candidate, issue] of [
      [{ ...event, signedAt: "2026-08-13T11:50:00.000Z" }, "replay window"],
      [{ ...event, occurredAt: "2026-06-01T00:00:00.000Z" }, "provider delay"],
      [{ ...event, pickerEmail: "private@example.com" }, "unsupported property"],
      [{ ...event, exchangeId: event.orderId }, "invalid for its target"],
    ] as const) {
      try {
        npRequireFreshShopPackingStatusEvent(candidate, now);
        throw new Error("Expected packing status rejection.");
      } catch (error) {
        expect(error).toBeInstanceOf(NpShopPackingStatusContractError);
        expect((error as NpShopPackingStatusContractError).issues.join(" ")).toContain(issue);
      }
    }
  });

  it("materializes provider events without invoking property getters", () => {
    let propertyReads = 0;
    const hostile = new Proxy(event, {
      get() {
        propertyReads += 1;
        throw new Error("hostile getter");
      },
    });
    expect(npRequireFreshShopPackingStatusEvent(hostile, now)).toEqual(event);
    expect(propertyReads).toBe(0);
    const hostileDescriptors = new Proxy(event, {
      getOwnPropertyDescriptor() {
        throw new Error("hostile descriptor");
      },
    });
    expect(() => npRequireFreshShopPackingStatusEvent(hostileDescriptors, now)).toThrow(
      NpShopPackingStatusContractError,
    );
    const revoked = Proxy.revocable(event, {});
    revoked.revoke();
    expect(() => npRequireFreshShopPackingStatusEvent(revoked.proxy, now)).toThrow(
      NpShopPackingStatusContractError,
    );
    try {
      npRequireFreshShopPackingStatusEvent(event, new Proxy(now, {}));
      throw new Error("Expected hostile receivedAt rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(NpShopPackingStatusContractError);
      expect((error as NpShopPackingStatusContractError).issues.join(" ")).toContain(
        "receivedAt is invalid",
      );
    }
    expect(() => npShopPackingStatusStorageKey("outbound", Symbol("order") as never)).toThrow(
      /storage identity/u,
    );
  });

  it("validates exact state and receipt identities", () => {
    const state = {
      contract: NP_SHOP_PACKING_STATUS_STORAGE_CONTRACT,
      providerId: "test-wms",
      workId: event.workId,
      orderId: event.orderId,
      target: event.target,
      exchangeId: event.exchangeId,
      providerWorkReference: event.providerWorkReference,
      status: event.status,
      latestEventId: event.eventId,
      occurredAt: event.occurredAt,
      packedAt: null,
      failedAt: null,
      updatedAt: now.toISOString(),
      purgeAt: "2027-08-13T12:00:00.000Z",
    } as const;
    const receipt = {
      contract: NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT,
      providerId: "test-wms",
      event,
      eventDigest: npShopPackingStatusEventDigest(event),
      outcome: "advanced",
      packingStatus: event.status,
      processedAt: now.toISOString(),
      purgeAt: state.purgeAt,
    } as const;
    expect(npAnalyzeStoredShopPackingStatus(state)).toEqual([]);
    expect(npAnalyzeStoredShopPackingStatusReceipt(receipt)).toEqual([]);
    expect(npAnalyzeStoredShopPackingStatus({ ...state, packedAt: event.occurredAt })).toContain(
      "stored non-packed status cannot set packedAt.",
    );
    expect(
      npAnalyzeStoredShopPackingStatusReceipt({ ...receipt, eventDigest: "0".repeat(64) }),
    ).toContain("stored packing status receipt.eventDigest must match its canonical event.");
    expect(
      npAnalyzeStoredShopPackingStatusReceipt({ ...receipt, packingStatus: "packed" }),
    ).toContain("advanced packing status receipt must retain the event status.");
  });

  it("derives PII-free canonical keys and hashes opaque provider event ids", () => {
    expect(npShopPackingStatusStorageKey("outbound", event.orderId)).toBe(
      `packing-status:outbound:${event.orderId}`,
    );
    const key = npShopPackingStatusReceiptStorageKey("test-wms", "secret-provider-event-id");
    expect(key).toMatch(/^packing-status-event:test-wms:[0-9a-f]{64}$/u);
    expect(key).not.toContain("secret-provider-event-id");
  });
});

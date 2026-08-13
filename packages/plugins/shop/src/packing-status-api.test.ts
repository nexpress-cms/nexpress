import { beforeEach, describe, expect, it, vi } from "vitest";

import { createShopPackingStatusApiHandler } from "./packing-status-api.js";
import {
  NP_SHOP_PACKING_STATUS_EVENT_CONTRACT,
  NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT,
  NP_SHOP_PACKING_STATUS_WEBHOOK_IGNORED_CONTRACT,
  npShopPackingStatusEventDigest,
} from "./packing-status-contract.js";

const applyPackingStatusEvent = vi.fn();

vi.mock("./packing-status-service.js", () => ({
  npApplyShopPackingStatusEvent: (...args: unknown[]) => applyPackingStatusEvent(...args),
}));

const event = {
  contract: NP_SHOP_PACKING_STATUS_EVENT_CONTRACT,
  eventId: "packing_evt_123",
  workId: "123e4567-e89b-42d3-a456-426614174000",
  orderId: "123e4567-e89b-42d3-a456-426614174001",
  target: "outbound",
  exchangeId: null,
  providerWorkReference: "wms-work-123",
  status: "packed",
  occurredAt: new Date().toISOString(),
  signedAt: new Date().toISOString(),
} as const;

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    path: "/packing/status/webhook",
    params: {},
    query: {},
    bodyMode: "raw",
    body: undefined,
    rawBody: new TextEncoder().encode('{"id":"packing_evt_123"}'),
    headers: { "x-wms-signature": "valid" },
    ...overrides,
  } as never;
}

describe("Shop packing status webhook", () => {
  beforeEach(() => applyPackingStatusEvent.mockReset());

  it("passes exact bytes and returns one bounded receipt", async () => {
    applyPackingStatusEvent.mockResolvedValue({
      duplicate: false,
      state: { status: "packed" },
      receipt: {
        contract: NP_SHOP_PACKING_STATUS_RECEIPT_CONTRACT,
        providerId: "test-wms",
        event,
        eventDigest: npShopPackingStatusEventDigest(event),
        outcome: "advanced",
        packingStatus: "packed",
        processedAt: new Date().toISOString(),
        purgeAt: "2027-08-13T00:00:00.000Z",
      },
    });
    const verifyPackingStatusWebhook = vi.fn(() => event);
    const response = await createShopPackingStatusApiHandler({
      id: "test-wms",
      createPackingWork: vi.fn(),
      cancelPackingWork: vi.fn(),
      verifyPackingStatusWebhook,
    })(request());
    expect(response).toMatchObject({
      status: 200,
      body: {
        receipt: { providerId: "test-wms", eventId: event.eventId, outcome: "advanced" },
        duplicate: false,
      },
    });
    expect(verifyPackingStatusWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: expect.any(Uint8Array),
        headers: { "x-wms-signature": "valid" },
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("x-wms-signature");
  });

  it("rejects non-raw and unverifiable callbacks before storage", async () => {
    const adapter = {
      id: "test-wms",
      createPackingWork: vi.fn(),
      cancelPackingWork: vi.fn(),
      verifyPackingStatusWebhook: vi.fn(() => null),
    };
    expect(
      (
        await createShopPackingStatusApiHandler(adapter)(
          request({ bodyMode: "json", rawBody: undefined }),
        )
      ).status,
    ).toBe(400);
    expect((await createShopPackingStatusApiHandler(adapter)(request())).status).toBe(401);
    expect(applyPackingStatusEvent).not.toHaveBeenCalled();
  });

  it("does not expose verifier errors", async () => {
    const response = await createShopPackingStatusApiHandler({
      id: "test-wms",
      createPackingWork: vi.fn(),
      cancelPackingWork: vi.fn(),
      verifyPackingStatusWebhook: vi.fn(() => {
        throw new Error("secret-provider-signature-detail");
      }),
    })(request());
    expect(response).toMatchObject({
      status: 401,
      body: { error: "packing_status_verification_failed" },
    });
    expect(JSON.stringify(response.body)).not.toContain("secret-provider-signature-detail");
    expect(applyPackingStatusEvent).not.toHaveBeenCalled();
  });

  it("acknowledges authenticated unsupported callbacks without storage", async () => {
    const response = await createShopPackingStatusApiHandler({
      id: "test-wms",
      createPackingWork: vi.fn(),
      cancelPackingWork: vi.fn(),
      verifyPackingStatusWebhook: vi.fn(
        () =>
          ({
            contract: NP_SHOP_PACKING_STATUS_WEBHOOK_IGNORED_CONTRACT,
            ignored: true,
            reason: "unsupported-event",
          }) as const,
      ),
    })(request());
    expect(response).toMatchObject({ status: 200, body: { ignored: true } });
    expect(applyPackingStatusEvent).not.toHaveBeenCalled();
  });
});

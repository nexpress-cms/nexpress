import { describe, expect, it } from "vitest";

import {
  NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT,
  NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT,
  npAnalyzeShopOrderNotificationPrivate,
  npAnalyzeShopOrderNotificationStorage,
  npRequireShopOrderNotificationListWire,
  type NpShopOrderNotificationStorage,
} from "./order-notification-contract.js";
import { npBuildShopOrderNotificationEmail } from "./order-notification-service.js";

const event: NpShopOrderNotificationStorage = {
  contract: NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT,
  id: "11111111-1111-4111-8111-111111111111",
  orderId: "22222222-2222-4222-8222-222222222222",
  ownerSegment: "member:33333333-3333-4333-8333-333333333333",
  kind: "payment.succeeded",
  orderRevision: 2,
  occurredAt: "2026-08-08T01:00:00.000Z",
  status: "pending",
  inboxStatus: "pending",
  emailStatus: "pending",
  notificationId: null,
  attempts: 0,
  claimId: null,
  claimedAt: null,
  leaseExpiresAt: null,
  nextAttemptAt: null,
  lastErrorCode: null,
  completedAt: null,
  purgeAt: "2027-08-08T01:00:00.000Z",
};

describe("Shop order notification contract", () => {
  it("accepts exact durable and owner-safe list values", () => {
    expect(npAnalyzeShopOrderNotificationStorage(event)).toEqual([]);
    expect(
      npRequireShopOrderNotificationListWire({
        contract: NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT,
        events: [{ id: event.id, kind: event.kind, occurredAt: event.occurredAt }],
      }),
    ).toEqual({
      contract: NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT,
      events: [{ id: event.id, kind: event.kind, occurredAt: event.occurredAt }],
    });
  });

  it("rejects guest inbox delivery and contradictory attention state", () => {
    expect(
      npAnalyzeShopOrderNotificationStorage({
        ...event,
        ownerSegment: `guest:${"a".repeat(64)}`,
      }),
    ).toContain("guest order notifications cannot target the member inbox.");
    expect(
      npAnalyzeShopOrderNotificationStorage({
        ...event,
        status: "attention",
        inboxStatus: "attention",
      }),
    ).toContain("attention order notifications require a bounded error code.");
    expect(
      npAnalyzeShopOrderNotificationStorage({
        ...event,
        attempts: 5,
      }),
    ).toContain("exhausted order notifications must enter attention state.");
  });

  it("bounds private email retention to a positive 24-hour window", () => {
    const privateValue = {
      contract: NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT,
      eventId: event.id,
      orderId: event.orderId,
      email: "buyer@example.com",
      createdAt: event.occurredAt,
      expiresAt: "2026-08-09T01:00:00.000Z",
    };
    expect(npAnalyzeShopOrderNotificationPrivate(privateValue)).toEqual([]);
    expect(
      npAnalyzeShopOrderNotificationPrivate({
        ...privateValue,
        expiresAt: "2026-08-09T01:00:00.001Z",
      }),
    ).toContain(
      "order notification private data expiry must follow creation within the fixed maximum lifetime.",
    );
  });

  it("builds one PII-free message with a stable event reference", () => {
    const message = npBuildShopOrderNotificationEmail(
      event,
      "/shop/orders/22222222-2222-4222-8222-222222222222",
    );
    expect(message.subject).toContain("Payment confirmed");
    expect(message.text).toContain(event.id);
    expect(message.html).not.toContain("buyer@example.com");
  });
});

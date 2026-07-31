import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
  NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
  npProjectShopPaymentAttempt,
  npRequireShopPaymentAttemptConfirmInput,
  npRequireShopPaymentAttemptCreateInput,
  npRequireShopPaymentPrepareResult,
  npRequireStoredShopPaymentAttempt,
} from "./payment-attempt-contract.js";

const id = "123e4567-e89b-42d3-a456-426614174000";
const orderId = "223e4567-e89b-42d3-a456-426614174000";
const createdAt = "2026-07-31T00:00:00.000Z";
const expiresAt = "2026-07-31T00:15:00.000Z";
const purgeAt = "2027-07-31T00:00:00.000Z";

function attempt() {
  return {
    contract: NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
    id,
    orderId,
    providerId: "test-pay",
    status: "prepared",
    orderRevision: 1,
    currency: "KRW",
    amountMinor: 25_000,
    orderName: "Everyday cup",
    handoff: {
      contract: NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
      providerId: "test-pay",
      attemptId: id,
      kind: "client",
      expiresAt,
      data: { clientKey: "public-key", amountMinor: 25_000 },
    },
    createdAt,
    expiresAt,
    confirmedAt: null,
    paymentReference: null,
    eventId: null,
    purgeAt,
  } as const;
}

describe("Shop payment attempt contract", () => {
  it("accepts exact create and confirmation inputs", () => {
    expect(npRequireShopPaymentAttemptCreateInput({ idempotencyKey: id, orderId })).toEqual({
      idempotencyKey: id,
      orderId,
    });
    expect(
      npRequireShopPaymentAttemptConfirmInput({
        attemptId: id,
        orderId,
        confirmation: { paymentKey: "pay_123", amount: 25_000 },
      }),
    ).toMatchObject({ attemptId: id, orderId });
    try {
      npRequireShopPaymentAttemptCreateInput({ idempotencyKey: id, orderId, extra: true });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([expect.stringMatching(/not supported/u)]),
      });
    }
  });

  it("bounds public handoff JSON and rejects secret-bearing keys", () => {
    expect(
      npRequireShopPaymentPrepareResult({
        kind: "client",
        data: { clientKey: "public", nested: { enabled: true } },
      }),
    ).toMatchObject({ kind: "client" });
    for (const [value, issue] of [
      [{ kind: "client", data: { secretKey: "must-not-leak" } }, /not an allowed public key/u],
      [{ kind: "client", data: { Authorization: "must-not-leak" } }, /not an allowed public key/u],
      [{ kind: "redirect", url: "http://payments.example" }, /HTTPS/u],
    ] as const) {
      try {
        npRequireShopPaymentPrepareResult(value);
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toMatchObject({
          issues: expect.arrayContaining([expect.stringMatching(issue)]),
        });
      }
    }
  });

  it("validates stored attempts and derives expiry without exposing order names", () => {
    const stored = npRequireStoredShopPaymentAttempt(attempt());
    const projected = npProjectShopPaymentAttempt(stored, new Date("2026-07-31T00:16:00.000Z"));
    expect(projected.status).toBe("expired");
    expect(projected).not.toHaveProperty("orderName");
    try {
      npRequireStoredShopPaymentAttempt({ ...attempt(), status: "confirmed" });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([expect.stringMatching(/require every confirmation/u)]),
      });
    }
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
  NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
  type NpShopPaymentAttempt,
} from "@nexpress/plugin-shop";

import { createTossPaymentsAdapter } from "./index.js";

const orderId = "123e4567-e89b-42d3-a456-426614174000";
const attemptId = "223e4567-e89b-42d3-a456-426614174000";
const paymentKey = "tviva20260731payment";
const refundId = "323e4567-e89b-42d3-a456-426614174000";

function payment(status = "DONE") {
  return { paymentKey, orderId, status, totalAmount: 25_000, currency: "KRW" };
}

function cancelledPayment(status = "CANCELED") {
  return {
    ...payment(status),
    balanceAmount: 0,
    cancels: [
      {
        cancelAmount: 25_000,
        canceledAt: "2026-08-01T09:05:00+09:00",
        transactionKey: "refund_transaction_123",
        cancelStatus: "DONE",
        refundableAmount: 0,
      },
    ],
  };
}

function partiallyCancelledPayment() {
  return {
    ...payment("PARTIAL_CANCELED"),
    balanceAmount: 15_000,
    cancels: [
      {
        cancelAmount: 10_000,
        canceledAt: "2026-08-05T09:05:00+09:00",
        transactionKey: "partial_refund_transaction_123",
        cancelStatus: "DONE",
        refundableAmount: 15_000,
      },
    ],
  };
}

function adapter(fetcher = vi.fn()) {
  return createTossPaymentsAdapter({
    clientKey: "test_gck_abcdefghijk12345",
    secretKey: "test_gsk_abcdefghijk12345",
    siteUrl: "https://shop.example",
    fetch: fetcher,
  });
}

function attempt(): NpShopPaymentAttempt {
  return {
    contract: NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
    id: attemptId,
    orderId,
    providerId: "toss-payments",
    status: "prepared",
    orderRevision: 1,
    currency: "KRW",
    amountMinor: 25_000,
    handoff: {
      contract: NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
      providerId: "toss-payments",
      attemptId,
      kind: "client",
      expiresAt: "2026-07-31T00:15:00.000Z",
      data: {},
    },
    createdAt: "2026-07-31T00:00:00.000Z",
    expiresAt: "2026-07-31T00:15:00.000Z",
    confirmedAt: null,
    paymentReference: null,
    eventId: null,
    purgeAt: "2027-07-31T00:00:00.000Z",
  };
}

describe("Toss Payments Shop adapter", () => {
  it("prepares only public KRW client handoff data", async () => {
    const current = adapter();
    const result = await current.preparePayment({
      attemptId,
      orderId,
      orderName: "Everyday cup",
      currency: "KRW",
      amountMinor: 25_000,
      expiresAt: "2026-07-31T00:15:00.000Z",
      successPath: `/shop/orders/${orderId}?npPayment=success&attempt=${attemptId}`,
      failPath: `/shop/orders/${orderId}?npPayment=fail&attempt=${attemptId}`,
    });
    expect(result).toMatchObject({
      kind: "client",
      data: {
        clientKey: "test_gck_abcdefghijk12345",
        currency: "KRW",
        successUrl: expect.stringContaining("npPayment=success"),
      },
    });
    expect(JSON.stringify(result)).not.toContain("test_gsk_");
    expect(() =>
      current.preparePayment({
        attemptId,
        orderId,
        orderName: "Everyday cup",
        currency: "USD",
        amountMinor: 25_000,
        expiresAt: "2026-07-31T00:15:00.000Z",
        successPath: "/success",
        failPath: "/fail",
      }),
    ).toThrow(/KRW/u);
    expect(() =>
      current.preparePayment({
        attemptId,
        orderId,
        orderName: "Free sample",
        currency: "KRW",
        amountMinor: 0,
        expiresAt: "2026-07-31T00:15:00.000Z",
        successPath: "/success",
        failPath: "/fail",
      }),
    ).toThrow(/positive/u);
    expect(() =>
      createTossPaymentsAdapter({
        clientKey: "test_gck_abcdefghijk12345",
        secretKey: "test_sk_abcdefghijk12345",
        siteUrl: "https://shop.example",
      }),
    ).toThrow(/key family/u);
  });

  it("confirms with secret Basic auth and the attempt UUID idempotency key", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payment()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const event = await adapter(fetcher).confirmPayment({
      attempt: attempt(),
      confirmation: { paymentKey, orderId, amount: 25_000 },
      receivedAt: "2026-07-31T00:05:00.000Z",
    });
    expect(event).toMatchObject({
      type: "payment.succeeded",
      orderId,
      amountMinor: 25_000,
      paymentReference: paymentKey,
    });
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /u),
      "Idempotency-Key": attemptId,
    });
    expect(init.body).toBe(JSON.stringify({ paymentKey, orderId, amount: 25_000 }));
  });

  it("never calls Toss when browser-returned order or amount differs", async () => {
    const fetcher = vi.fn();
    await expect(
      adapter(fetcher).confirmPayment({
        attempt: attempt(),
        confirmation: { paymentKey, orderId, amount: 1 },
        receivedAt: "2026-07-31T00:05:00.000Z",
      }),
    ).rejects.toThrow(/did not match/u);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels the entire payment with the durable refund UUID", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cancelledPayment()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await adapter(fetcher).refundPayment({
      refundId,
      orderId,
      paymentReference: paymentKey,
      currency: "KRW",
      amountMinor: 25_000,
      reason: "Customer requested cancellation",
      requestedAt: "2026-08-01T00:04:00.000Z",
    });
    expect(result).toEqual({
      contract: "np.shop-refund-result.v1",
      refundId,
      orderId,
      paymentReference: paymentKey,
      refundReference: "refund_transaction_123",
      currency: "KRW",
      amountMinor: 25_000,
      refundedAt: "2026-08-01T00:05:00.000Z",
    });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/v1/payments/${paymentKey}/cancel`);
    expect(init.headers).toMatchObject({ "Idempotency-Key": refundId });
    expect(init.body).toBe(JSON.stringify({ cancelReason: "Customer requested cancellation" }));
    expect(init.body).not.toContain("cancelAmount");
  });

  it("partially cancels one received return allocation with the durable refund UUID", async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(partiallyCancelledPayment()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const returnId = "423e4567-e89b-42d3-a456-426614174000";
    const result = await adapter(fetcher).refundPaymentPartially({
      refundId,
      orderId,
      returnId,
      paymentReference: paymentKey,
      currency: "KRW",
      amountMinor: 10_000,
      allocation: {
        lines: [{ lineKey: "line-1", quantity: 1, amountMinor: 10_000 }],
        itemAmountMinor: 10_000,
        shippingMinor: 0,
        taxMinor: 0,
      },
      reason: "Received defective return",
      requestedAt: "2026-08-05T00:04:00.000Z",
    });
    expect(result).toEqual({
      contract: "np.shop-partial-refund-result.v1",
      refundId,
      orderId,
      returnId,
      paymentReference: paymentKey,
      refundReference: "partial_refund_transaction_123",
      currency: "KRW",
      amountMinor: 10_000,
      refundedAt: "2026-08-05T00:05:00.000Z",
    });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/v1/payments/${paymentKey}/cancel`);
    expect(init.headers).toMatchObject({ "Idempotency-Key": refundId });
    expect(init.body).toBe(
      JSON.stringify({ cancelReason: "Received defective return", cancelAmount: 10_000 }),
    );
  });

  it("cancels only the exact net refund after quote-backed return-postage settlement", async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(partiallyCancelledPayment()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const returnId = "423e4567-e89b-42d3-a456-426614174000";
    const current = adapter(fetcher);
    const input = {
      refundId,
      orderId,
      returnId,
      paymentReference: paymentKey,
      currency: "KRW" as const,
      amountMinor: 10_000,
      allocation: {
        lines: [{ lineKey: "line-1", quantity: 1, amountMinor: 14_000 }],
        itemAmountMinor: 14_000,
        shippingMinor: 0,
        taxMinor: 0,
      },
      postageSettlement: {
        contract: "np.shop-return-postage-settlement.v1" as const,
        responsibility: "customer" as const,
        method: {
          contract: "np.shop-return-postage-method.v1" as const,
          providerId: "test-carrier",
          quoteId: "523e4567-e89b-42d3-a456-426614174000",
          methodId: "dropoff-standard",
          label: "Standard return",
          currency: "KRW" as const,
          amountMinor: 4_000,
          estimatedTransit: null,
          quotedAt: "2026-08-05T00:00:00.000Z",
          quoteExpiresAt: "2026-08-05T01:00:00.000Z",
        },
        deductionMinor: 4_000,
        designatedAt: "2026-08-05T00:04:00.000Z",
      },
      reason: "Received changed-mind return",
      requestedAt: "2026-08-05T00:04:00.000Z",
    };
    await expect(current.refundReturnSettlement(input)).resolves.toMatchObject({
      amountMinor: 10_000,
      refundReference: "partial_refund_transaction_123",
    });
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ cancelReason: input.reason, cancelAmount: 10_000 }));

    await expect(
      current.refundReturnSettlement({
        ...input,
        refundId: "623e4567-e89b-42d3-a456-426614174000",
        allocation: {
          lines: [{ lineKey: "line-1", quantity: 1, amountMinor: 10_000 }],
          itemAmountMinor: 10_000,
          shippingMinor: 0,
          taxMinor: 0,
        },
        postageSettlement: {
          ...input.postageSettlement,
          responsibility: "merchant",
          deductionMinor: 0,
        },
      }),
    ).resolves.toMatchObject({ amountMinor: 10_000 });

    await expect(
      current.refundReturnSettlement({
        ...input,
        postageSettlement: { ...input.postageSettlement, deductionMinor: 3_999 },
      }),
    ).rejects.toMatchObject({ code: "toss_return_settlement_mismatch", retryable: false });
    await expect(
      current.refundReturnSettlement({
        ...input,
        postageSettlement: {
          ...input.postageSettlement,
          method: { ...input.postageSettlement.method, amountMinor: -4_000 },
        },
      }),
    ).rejects.toMatchObject({ code: "toss_return_settlement_mismatch", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Toss returns a partial cancellation", async () => {
    const partial = cancelledPayment("PARTIAL_CANCELED");
    partial.balanceAmount = 10_000;
    partial.cancels[0].cancelAmount = 15_000;
    partial.cancels[0].refundableAmount = 10_000;
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(partial), { status: 200 }));
    await expect(
      adapter(fetcher).refundPayment({
        refundId,
        orderId,
        paymentReference: paymentKey,
        currency: "KRW",
        amountMinor: 25_000,
        reason: "Customer requested cancellation",
        requestedAt: "2026-08-01T00:04:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "toss_refund_mismatch", retryable: false });
  });

  it("bounds provider responses before parsing them", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`{"padding":"${"x".repeat(70_000)}"}`));
    await expect(
      adapter(fetcher).confirmPayment({
        attempt: attempt(),
        confirmation: { paymentKey, orderId, amount: 25_000 },
        receivedAt: "2026-07-31T00:05:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "toss_response_too_large" });
  });

  it("re-queries general payment webhooks and ignores non-terminal states", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payment("IN_PROGRESS")), { status: 200 }));
    const result = await adapter(fetcher).verifyWebhook({
      rawBody: new TextEncoder().encode(
        JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", data: payment("IN_PROGRESS") }),
      ),
      headers: { "tosspayments-webhook-transmission-id": "transmission_123" },
      receivedAt: "2026-07-31T00:05:00.000Z",
    });
    expect(result).toMatchObject({ ignored: true, reason: "non-terminal" });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/payments/${paymentKey}`),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("projects authoritative full and cumulative partial cancellations as adjustments", async () => {
    const cumulativePartial = partiallyCancelledPayment();
    cumulativePartial.balanceAmount = 10_000;
    cumulativePartial.cancels = [
      {
        cancelAmount: 5_000,
        canceledAt: "2026-08-05T10:05:00+09:00",
        transactionKey: "partial_refund_transaction_456",
        cancelStatus: "DONE",
        refundableAmount: 10_000,
      },
      cumulativePartial.cancels[0],
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(cancelledPayment()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(cumulativePartial), { status: 200 }));
    const current = adapter(fetcher);
    const full = await current.verifyWebhook({
      rawBody: new TextEncoder().encode(
        JSON.stringify({
          eventType: "PAYMENT_STATUS_CHANGED",
          data: cancelledPayment(),
        }),
      ),
      headers: {},
      receivedAt: "2026-08-05T00:05:00.000Z",
    });
    const partial = await current.verifyWebhook({
      rawBody: new TextEncoder().encode(
        JSON.stringify({
          eventType: "PAYMENT_STATUS_CHANGED",
          data: cumulativePartial,
        }),
      ),
      headers: {},
      receivedAt: "2026-08-05T00:05:01.000Z",
    });
    expect(full).toMatchObject({
      contract: "np.shop-payment-adjustment-event.v1",
      orderId,
      originalAmountMinor: 25_000,
      remainingAmountMinor: 0,
      cancellations: [
        {
          reference: "refund_transaction_123",
          amountMinor: 25_000,
          cancelledAt: "2026-08-01T00:05:00.000Z",
        },
      ],
    });
    expect(partial).toMatchObject({
      contract: "np.shop-payment-adjustment-event.v1",
      remainingAmountMinor: 10_000,
      cancellations: [
        { reference: "partial_refund_transaction_123", amountMinor: 10_000 },
        { reference: "partial_refund_transaction_456", amountMinor: 5_000 },
      ],
    });
  });

  it("fails closed when authoritative cancellation totals do not match the balance", async () => {
    const malformed = partiallyCancelledPayment();
    malformed.cancels[0].cancelAmount = 9_999;
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(malformed), { status: 200 }));
    await expect(
      adapter(fetcher).verifyWebhook({
        rawBody: new TextEncoder().encode(
          JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", data: malformed }),
        ),
        headers: {},
        receivedAt: "2026-08-05T00:05:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "toss_adjustment_mismatch", retryable: false });
  });

  it("does not acknowledge unsupported webhook events without provider verification", async () => {
    const fetcher = vi.fn();
    await expect(
      adapter(fetcher).verifyWebhook({
        rawBody: new TextEncoder().encode(
          JSON.stringify({ eventType: "PAYOUT_STATUS_CHANGED", data: payment() }),
        ),
        headers: {},
        receivedAt: "2026-07-31T00:05:00.000Z",
      }),
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("derives terminal webhook ids from the verified payment instead of untrusted delivery data", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(payment()), { status: 200 })),
      );
    const current = adapter(fetcher);
    const confirmed = await current.confirmPayment({
      attempt: attempt(),
      confirmation: { paymentKey, orderId, amount: 25_000 },
      receivedAt: "2026-07-31T00:04:59.000Z",
    });
    const first = await current.verifyWebhook({
      rawBody: new TextEncoder().encode(
        JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", data: payment(), extra: "first" }),
      ),
      headers: { "tosspayments-webhook-transmission-id": "untrusted_first" },
      receivedAt: "2026-07-31T00:05:00.000Z",
    });
    const second = await current.verifyWebhook({
      rawBody: new TextEncoder().encode(
        JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", data: payment(), extra: "second" }),
      ),
      headers: { "tosspayments-webhook-transmission-id": "untrusted_second" },
      receivedAt: "2026-07-31T00:05:01.000Z",
    });
    expect(first).toMatchObject({
      type: "payment.succeeded",
      eventId: confirmed.eventId,
    });
    expect(second).toMatchObject({ eventId: (first as { eventId: string }).eventId });
  });
});

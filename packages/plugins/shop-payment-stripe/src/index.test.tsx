import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
  NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
  type NpShopPaymentAttempt,
  type NpShopPaymentWebhookInput,
} from "@nexpress/plugin-shop";

import { createStripePaymentsAdapter } from "./index.js";

const orderId = "123e4567-e89b-42d3-a456-426614174000";
const attemptId = "223e4567-e89b-42d3-a456-426614174000";
const refundId = "323e4567-e89b-42d3-a456-426614174000";
const returnId = "423e4567-e89b-42d3-a456-426614174000";
const paymentIntentId = "pi_1234567890abcdefgh";
const webhookSecret = "whsec_1234567890abcdefgh";
const receivedAt = "2026-08-13T03:00:00.000Z";
const signedSeconds = Math.floor(new Date(receivedAt).getTime() / 1_000);

function paymentIntent(
  status = "succeeded",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: paymentIntentId,
    object: "payment_intent",
    amount: 2_500,
    amount_received: status === "succeeded" ? 2_500 : 0,
    currency: "usd",
    status,
    client_secret: `${paymentIntentId}_secret_1234567890abcdef`,
    metadata: {
      nexpress_order_id: orderId,
      nexpress_attempt_id: attemptId,
    },
    ...overrides,
  };
}

function refund(
  id = "re_1234567890abcdefgh",
  amount = 2_500,
  created = signedSeconds - 10,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    object: "refund",
    amount,
    currency: "usd",
    created,
    payment_intent: paymentIntentId,
    status: "succeeded",
    metadata: {},
    ...overrides,
  };
}

function dispute(
  status = "needs_response",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "dp_1234567890abcdefgh",
    object: "dispute",
    amount: 1_250,
    currency: "usd",
    payment_intent: paymentIntentId,
    status,
    reason: "fraudulent",
    ...overrides,
  };
}

function partialRefundMetadata(
  kind: "received-return" | "return-postage-settlement",
  currentRefundId = refundId,
) {
  return {
    nexpress_refund_id: currentRefundId,
    nexpress_order_id: orderId,
    nexpress_return_id: returnId,
    nexpress_refund_kind: kind,
  };
}

function attempt(): NpShopPaymentAttempt {
  return {
    contract: NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
    id: attemptId,
    orderId,
    providerId: "stripe",
    status: "prepared",
    orderRevision: 1,
    currency: "USD",
    amountMinor: 2_500,
    handoff: {
      contract: NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
      providerId: "stripe",
      attemptId,
      kind: "client",
      expiresAt: "2026-08-13T03:15:00.000Z",
      data: { paymentIntentId },
    },
    createdAt: "2026-08-13T03:00:00.000Z",
    expiresAt: "2026-08-13T03:15:00.000Z",
    confirmedAt: null,
    paymentReference: null,
    eventId: null,
    purgeAt: "2027-08-13T03:00:00.000Z",
  };
}

function adapter(fetcher = vi.fn()) {
  return createStripePaymentsAdapter({
    publishableKey: "pk_test_1234567890abcdefgh",
    secretKey: "sk_test_1234567890abcdefgh",
    webhookSecret,
    siteUrl: "https://shop.example",
    fetch: fetcher,
  });
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signedWebhook(
  type: string,
  object: Record<string, unknown>,
  timestamp = signedSeconds,
): NpShopPaymentWebhookInput {
  const rawBody = new TextEncoder().encode(
    JSON.stringify({
      id: "evt_1234567890abcdefgh",
      object: "event",
      created: timestamp,
      type,
      data: { object },
    }),
  );
  const signature = createHmac("sha256", webhookSecret)
    .update(String(timestamp))
    .update(".")
    .update(rawBody)
    .digest("hex");
  return {
    rawBody,
    headers: { "Stripe-Signature": `t=${timestamp.toString()},v1=${signature}` },
    receivedAt,
  };
}

describe("Stripe Shop payment adapter", () => {
  it("creates one exact public PaymentIntent handoff with the attempt UUID idempotency key", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(paymentIntent("requires_payment_method")));
    const result = await adapter(fetcher).preparePayment({
      attemptId,
      orderId,
      orderName: "Everyday cup",
      currency: "USD",
      amountMinor: 2_500,
      expiresAt: "2026-08-13T03:15:00.000Z",
      successPath: `/shop/orders/${orderId}?npPayment=success&attempt=${attemptId}`,
      failPath: `/shop/orders/${orderId}?npPayment=fail&attempt=${attemptId}`,
    });
    expect(result).toMatchObject({
      kind: "client",
      data: {
        publishableKey: "pk_test_1234567890abcdefgh",
        paymentIntentId,
        intentToken: `${paymentIntentId}_secret_1234567890abcdef`,
        amountMinor: 2_500,
        currency: "USD",
      },
    });
    expect(JSON.stringify(result)).not.toContain("sk_test_");
    expect(JSON.stringify(result)).not.toContain("whsec_");
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/payment_intents");
    expect(init.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /u),
      "Idempotency-Key": attemptId,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toMatchObject({
      amount: "2500",
      currency: "usd",
      "automatic_payment_methods[enabled]": "true",
      "metadata[nexpress_order_id]": orderId,
      "metadata[nexpress_attempt_id]": attemptId,
    });
  });

  it("rejects mismatched key modes and invalid amounts before provider I/O", async () => {
    expect(() =>
      createStripePaymentsAdapter({
        publishableKey: "pk_test_1234567890abcdefgh",
        secretKey: "sk_live_1234567890abcdefgh",
        webhookSecret,
        siteUrl: "https://shop.example",
      }),
    ).toThrow(/same test\/live mode/u);
    const fetcher = vi.fn();
    await expect(
      adapter(fetcher).preparePayment({
        attemptId,
        orderId,
        orderName: "Free sample",
        currency: "USD",
        amountMinor: 0,
        expiresAt: "2026-08-13T03:15:00.000Z",
        successPath: "/success",
        failPath: "/fail",
      }),
    ).rejects.toMatchObject({ code: "stripe_amount_unsupported", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("confirms only the stored PaymentIntent through the secret API", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(paymentIntent()));
    const event = await adapter(fetcher).confirmPayment({
      attempt: attempt(),
      confirmation: { paymentIntentId },
      receivedAt,
    });
    expect(event).toMatchObject({
      type: "payment.succeeded",
      orderId,
      paymentReference: paymentIntentId,
      currency: "USD",
      amountMinor: 2_500,
    });
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`,
      expect.objectContaining({ method: "GET" }),
    );

    const rejectedFetcher = vi.fn();
    await expect(
      adapter(rejectedFetcher).confirmPayment({
        attempt: attempt(),
        confirmation: { paymentIntentId: "pi_zzzzzzzzzzzzzzzz" },
        receivedAt,
      }),
    ).rejects.toMatchObject({ code: "stripe_confirmation_mismatch", retryable: false });
    expect(rejectedFetcher).not.toHaveBeenCalled();
  });

  it("creates one exact full refund with the durable Shop UUID", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(refund()));
    const result = await adapter(fetcher).refundPayment({
      refundId,
      orderId,
      paymentReference: paymentIntentId,
      currency: "USD",
      amountMinor: 2_500,
      reason: "Customer requested cancellation",
      requestedAt: receivedAt,
    });
    expect(result).toEqual({
      contract: "np.shop-refund-result.v1",
      refundId,
      orderId,
      paymentReference: paymentIntentId,
      refundReference: "re_1234567890abcdefgh",
      currency: "USD",
      amountMinor: 2_500,
      refundedAt: new Date((signedSeconds - 10) * 1_000).toISOString(),
    });
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "Idempotency-Key": refundId });
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toMatchObject({
      payment_intent: paymentIntentId,
      amount: "2500",
      reason: "requested_by_customer",
      "metadata[nexpress_refund_id]": refundId,
    });
  });

  it("keeps non-terminal refunds retryable instead of recording local completion", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ ...refund(), status: "pending" }));
    await expect(
      adapter(fetcher).refundPayment({
        refundId,
        orderId,
        paymentReference: paymentIntentId,
        currency: "USD",
        amountMinor: 2_500,
        reason: "Customer requested cancellation",
        requestedAt: receivedAt,
      }),
    ).rejects.toMatchObject({ code: "stripe_refund_mismatch", retryable: true });
  });

  it("creates one exact received-return partial refund with durable Stripe metadata", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ object: "list", has_more: false, data: [] }))
      .mockResolvedValueOnce(
        response(
          refund(undefined, 1_000, undefined, {
            metadata: partialRefundMetadata("received-return"),
          }),
        ),
      );
    const result = await adapter(fetcher).refundPaymentPartially({
      refundId,
      orderId,
      returnId,
      paymentReference: paymentIntentId,
      currency: "USD",
      amountMinor: 1_000,
      allocation: {
        lines: [{ lineKey: "line-1", quantity: 1, amountMinor: 900 }],
        itemAmountMinor: 900,
        shippingMinor: 50,
        taxMinor: 50,
      },
      reason: "Received defective return",
      requestedAt: receivedAt,
    });
    expect(result).toEqual({
      contract: "np.shop-partial-refund-result.v1",
      refundId,
      orderId,
      returnId,
      paymentReference: paymentIntentId,
      refundReference: "re_1234567890abcdefgh",
      currency: "USD",
      amountMinor: 1_000,
      refundedAt: new Date((signedSeconds - 10) * 1_000).toISOString(),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      `/v1/refunds?payment_intent=${paymentIntentId}&limit=100`,
    );
    const [url, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/refunds");
    expect(init.headers).toMatchObject({ "Idempotency-Key": refundId });
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      payment_intent: paymentIntentId,
      amount: "1000",
      reason: "requested_by_customer",
      "metadata[nexpress_refund_id]": refundId,
      "metadata[nexpress_order_id]": orderId,
      "metadata[nexpress_return_id]": returnId,
      "metadata[nexpress_refund_kind]": "received-return",
    });
  });

  it("reconciles a durable partial refund without relying on Stripe's idempotency TTL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        object: "list",
        has_more: false,
        data: [
          refund(undefined, 1_000, undefined, {
            metadata: partialRefundMetadata("received-return"),
          }),
        ],
      }),
    );
    await expect(
      adapter(fetcher).refundPaymentPartially({
        refundId,
        orderId,
        returnId,
        paymentReference: paymentIntentId,
        currency: "USD",
        amountMinor: 1_000,
        allocation: {
          lines: [{ lineKey: "line-1", quantity: 1, amountMinor: 1_000 }],
          itemAmountMinor: 1_000,
          shippingMinor: 0,
          taxMinor: 0,
        },
        reason: "Received defective return",
        requestedAt: receivedAt,
      }),
    ).resolves.toMatchObject({ refundReference: "re_1234567890abcdefgh" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("rejects a drifted received-return allocation before Stripe I/O", async () => {
    const fetcher = vi.fn();
    await expect(
      adapter(fetcher).refundPaymentPartially({
        refundId,
        orderId,
        returnId,
        paymentReference: paymentIntentId,
        currency: "USD",
        amountMinor: 1_000,
        allocation: {
          lines: [{ lineKey: "line-1", quantity: 1, amountMinor: 999 }],
          itemAmountMinor: 1_000,
          shippingMinor: 0,
          taxMinor: 0,
        },
        reason: "Received defective return",
        requestedAt: receivedAt,
      }),
    ).rejects.toMatchObject({ code: "stripe_partial_refund_mismatch", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refunds only the exact net amount for a quote-backed postage settlement", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ object: "list", has_more: false, data: [] }))
      .mockResolvedValueOnce(
        response(
          refund(undefined, 1_000, undefined, {
            metadata: partialRefundMetadata("return-postage-settlement"),
          }),
        ),
      );
    const input = {
      refundId,
      orderId,
      returnId,
      paymentReference: paymentIntentId,
      currency: "USD" as const,
      amountMinor: 1_000,
      allocation: {
        lines: [{ lineKey: "line-1", quantity: 1, amountMinor: 1_400 }],
        itemAmountMinor: 1_400,
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
          currency: "USD" as const,
          amountMinor: 400,
          estimatedTransit: null,
          quotedAt: receivedAt,
          quoteExpiresAt: "2026-08-13T04:00:00.000Z",
        },
        deductionMinor: 400,
        designatedAt: receivedAt,
      },
      reason: "Received changed-mind return",
      requestedAt: receivedAt,
    };
    await expect(adapter(fetcher).refundReturnSettlement(input)).resolves.toMatchObject({
      amountMinor: 1_000,
      returnId,
    });
    const [, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toMatchObject({
      amount: "1000",
      "metadata[nexpress_refund_kind]": "return-postage-settlement",
    });

    const rejectedFetcher = vi.fn();
    await expect(
      adapter(rejectedFetcher).refundReturnSettlement({
        ...input,
        postageSettlement: { ...input.postageSettlement, deductionMinor: 399 },
      }),
    ).rejects.toMatchObject({ code: "stripe_return_settlement_mismatch", retryable: false });
    expect(rejectedFetcher).not.toHaveBeenCalled();
  });

  it("absorbs merchant-responsibility return postage without creating a separate charge", async () => {
    const merchantRefundId = "623e4567-e89b-42d3-a456-426614174000";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ object: "list", has_more: false, data: [] }))
      .mockResolvedValueOnce(
        response(
          refund(undefined, 1_400, undefined, {
            metadata: partialRefundMetadata("return-postage-settlement", merchantRefundId),
          }),
        ),
      );
    await expect(
      adapter(fetcher).refundReturnSettlement({
        refundId: merchantRefundId,
        orderId,
        returnId,
        paymentReference: paymentIntentId,
        currency: "USD",
        amountMinor: 1_400,
        allocation: {
          lines: [{ lineKey: "line-1", quantity: 1, amountMinor: 1_400 }],
          itemAmountMinor: 1_400,
          shippingMinor: 0,
          taxMinor: 0,
        },
        postageSettlement: {
          contract: "np.shop-return-postage-settlement.v1",
          responsibility: "merchant",
          method: {
            contract: "np.shop-return-postage-method.v1",
            providerId: "test-carrier",
            quoteId: "523e4567-e89b-42d3-a456-426614174000",
            methodId: "dropoff-standard",
            label: "Standard return",
            currency: "USD",
            amountMinor: 400,
            estimatedTransit: null,
            quotedAt: receivedAt,
            quoteExpiresAt: "2026-08-13T04:00:00.000Z",
          },
          deductionMinor: 0,
          designatedAt: receivedAt,
        },
        reason: "Received merchant-responsibility return",
        requestedAt: receivedAt,
      }),
    ).resolves.toMatchObject({ amountMinor: 1_400 });
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.stripe.com/v1/refunds");
    const [, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toMatchObject({
      amount: "1400",
      "metadata[nexpress_refund_kind]": "return-postage-settlement",
    });
  });

  it("authenticates the exact raw webhook and emits the same success event id as confirmation", async () => {
    const current = adapter();
    const result = await current.verifyWebhook(
      signedWebhook("payment_intent.succeeded", paymentIntent()),
    );
    expect(result).toMatchObject({
      contract: "np.shop-payment-event.v1",
      type: "payment.succeeded",
      paymentReference: paymentIntentId,
      signedAt: new Date(signedSeconds * 1_000).toISOString(),
    });
    expect((result as { eventId: string }).eventId).toMatch(/^payment:[0-9a-f]{64}$/u);
  });

  it("rejects invalid and stale Stripe signatures before parsing provider fields", async () => {
    const current = adapter();
    const invalid = signedWebhook("payment_intent.succeeded", paymentIntent());
    invalid.headers = { "stripe-signature": `t=${signedSeconds.toString()},v1=${"0".repeat(64)}` };
    await expect(current.verifyWebhook(invalid)).resolves.toBeNull();
    await expect(
      current.verifyWebhook(
        signedWebhook("payment_intent.succeeded", paymentIntent(), signedSeconds - 301),
      ),
    ).resolves.toBeNull();
  });

  it("projects a signed refund delivery as one authoritative cumulative snapshot", async () => {
    const secondRefund = refund("re_zzzzzzzzzzzzzzzz", 500, signedSeconds - 20);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(paymentIntent()))
      .mockResolvedValueOnce(
        response({
          object: "list",
          has_more: false,
          data: [refund("re_1234567890abcdefgh", 2_000, signedSeconds - 10), secondRefund],
        }),
      );
    const event = await adapter(fetcher).verifyWebhook(
      signedWebhook("refund.updated", secondRefund),
    );
    expect(event).toMatchObject({
      contract: "np.shop-payment-adjustment-event.v1",
      orderId,
      paymentReference: paymentIntentId,
      originalAmountMinor: 2_500,
      remainingAmountMinor: 0,
      cancellations: [
        { reference: "re_zzzzzzzzzzzzzzzz", amountMinor: 500 },
        { reference: "re_1234567890abcdefgh", amountMinor: 2_000 },
      ],
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/v1/refunds?payment_intent=${paymentIntentId}&limit=100`),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("normalizes authenticated Stripe disputes against the authoritative PaymentIntent", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(paymentIntent()));
    const result = await adapter(fetcher).verifyWebhook(
      signedWebhook("charge.dispute.created", dispute()),
    );
    expect(result).toEqual({
      contract: "np.shop-payment-dispute-event.v1",
      eventId: "evt_1234567890abcdefgh",
      disputeReference: "dp_1234567890abcdefgh",
      orderId,
      paymentReference: paymentIntentId,
      currency: "USD",
      amountMinor: 1_250,
      status: "needs-response",
      reasonCode: "fraudulent",
      occurredAt: new Date(signedSeconds * 1_000).toISOString(),
      signedAt: new Date(signedSeconds * 1_000).toISOString(),
    });
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("accepts only terminal closed disputes and fails closed on payment mismatches", async () => {
    await expect(
      adapter().verifyWebhook(signedWebhook("charge.dispute.closed", dispute())),
    ).resolves.toBeNull();

    const closedFetcher = vi.fn().mockResolvedValue(response(paymentIntent()));
    await expect(
      adapter(closedFetcher).verifyWebhook(signedWebhook("charge.dispute.closed", dispute("lost"))),
    ).resolves.toMatchObject({ status: "lost", reasonCode: "fraudulent" });

    const mismatchFetcher = vi.fn().mockResolvedValue(response(paymentIntent()));
    await expect(
      adapter(mismatchFetcher).verifyWebhook(
        signedWebhook("charge.dispute.updated", dispute("under_review", { amount: 2_501 })),
      ),
    ).rejects.toMatchObject({ code: "stripe_dispute_mismatch", retryable: false });
  });

  it("fails closed when the authoritative refund snapshot exceeds the bounded contract", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(paymentIntent()))
      .mockResolvedValueOnce(response({ object: "list", has_more: true, data: [refund()] }));
    await expect(
      adapter(fetcher).verifyWebhook(signedWebhook("refund.created", refund())),
    ).rejects.toMatchObject({ code: "stripe_adjustment_limit", retryable: false });
  });

  it("acknowledges an authenticated unsupported event without changing Shop state", async () => {
    const result = await adapter().verifyWebhook(
      signedWebhook("customer.created", { id: "cus_1234567890abcdefgh", object: "customer" }),
    );
    expect(result).toEqual({
      contract: "np.shop-payment-webhook-ignored.v1",
      ignored: true,
      reason: "unsupported-event",
    });
  });

  it("bounds Stripe responses before parsing", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ padding: "x".repeat(70_000) }));
    await expect(
      adapter(fetcher).confirmPayment({
        attempt: attempt(),
        confirmation: { paymentIntentId },
        receivedAt,
      }),
    ).rejects.toMatchObject({ code: "stripe_response_too_large" });
  });
});

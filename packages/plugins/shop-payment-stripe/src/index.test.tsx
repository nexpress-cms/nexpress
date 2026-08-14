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
): Record<string, unknown> {
  return {
    id,
    object: "refund",
    amount,
    currency: "usd",
    created,
    payment_intent: paymentIntentId,
    status: "succeeded",
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
    JSON.stringify({ id: "evt_1234567890abcdefgh", object: "event", type, data: { object } }),
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

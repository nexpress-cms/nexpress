import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT,
  NP_SHOP_REFUND_RESULT_CONTRACT,
  NpShopPaymentProviderError,
  npShopCurrencies,
  type NpShopIgnoredPaymentWebhook,
  type NpShopPaymentConfirmAdapterInput,
  type NpShopPaymentInitiationAdapter,
  type NpShopPaymentLauncherProps,
  type NpShopPaymentPrepareInput,
  type NpShopPaymentPrepareResult,
  type NpShopPaymentRefundAdapter,
  type NpShopPaymentRefundInput,
  type NpShopPaymentRefundResult,
  type NpShopPaymentWebhookInput,
  type NpShopPaymentWebhookResult,
  type NpShopVerifiedPaymentAdjustmentEvent,
  type NpShopVerifiedPaymentEvent,
} from "@nexpress/plugin-shop";
import { StripePaymentLauncher } from "@nexpress/shop-payment-stripe/client";

export const STRIPE_API_ORIGIN = "https://api.stripe.com";
export const STRIPE_SDK_URL = "https://js.stripe.com/v3";

const keyPattern = /^(pk|sk)_(test|live)_[A-Za-z0-9_]{8,220}$/u;
const webhookSecretPattern = /^whsec_[A-Za-z0-9]{8,220}$/u;
const paymentIntentPattern = /^pi_[A-Za-z0-9]{8,200}$/u;
const refundPattern = /^re_[A-Za-z0-9]{8,200}$/u;
const chargePattern = /^ch_[A-Za-z0-9]{8,200}$/u;
const stripeEventPattern = /^evt_[A-Za-z0-9]{8,200}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const currencyPattern = /^[a-z]{3}$/u;

export interface NpStripePaymentsOptions {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  siteUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface StripePaymentIntent {
  id: string;
  amount: number;
  amountReceived: number;
  currency: string;
  status: string;
  orderId: string;
  attemptId: string;
  intentToken: string | null;
}

interface StripeRefund {
  id: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  created: number;
  status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownData(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function boundedText(value: unknown, maximum = 200): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function requireSiteUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Stripe siteUrl must be one canonical HTTPS origin.");
  }
  return url.origin;
}

function requireKey(value: string, kind: "pk" | "sk"): { value: string; mode: string } {
  const match = keyPattern.exec(value);
  if (!match || match[1] !== kind) {
    throw new Error(`Stripe ${kind === "pk" ? "publishable" : "secret"} key is invalid.`);
  }
  return { value, mode: match[2] };
}

function requireWebhookSecret(value: string): string {
  if (!webhookSecretPattern.test(value)) throw new Error("Stripe webhook secret is invalid.");
  return value;
}

function requirePaymentIntent(value: unknown, requireToken = false): StripePaymentIntent {
  if (!isRecord(value) || ownData(value, "object") !== "payment_intent") {
    throw new NpShopPaymentProviderError(
      "stripe_invalid_response",
      "Stripe returned no PaymentIntent.",
    );
  }
  const id = boundedText(ownData(value, "id"));
  const currency = boundedText(ownData(value, "currency"), 3);
  const status = boundedText(ownData(value, "status"), 40);
  const metadata = ownData(value, "metadata");
  const clientSecret = ownData(value, "client_secret");
  const amount = ownData(value, "amount");
  const amountReceived = ownData(value, "amount_received");
  const orderId = isRecord(metadata)
    ? boundedText(ownData(metadata, "nexpress_order_id"), 64)
    : null;
  const attemptId = isRecord(metadata)
    ? boundedText(ownData(metadata, "nexpress_attempt_id"), 64)
    : null;
  if (
    !id ||
    !paymentIntentPattern.test(id) ||
    !currency ||
    !currencyPattern.test(currency) ||
    !(npShopCurrencies as readonly string[]).includes(currency.toUpperCase()) ||
    !status ||
    !Number.isSafeInteger(amount) ||
    (amount as number) < 1 ||
    !Number.isSafeInteger(amountReceived) ||
    (amountReceived as number) < 0 ||
    !orderId ||
    !uuidPattern.test(orderId) ||
    !attemptId ||
    !uuidPattern.test(attemptId) ||
    (requireToken &&
      (typeof clientSecret !== "string" ||
        clientSecret.length > 500 ||
        !clientSecret.startsWith(`${id}_secret_`)))
  ) {
    throw new NpShopPaymentProviderError(
      "stripe_invalid_response",
      "Stripe returned a malformed PaymentIntent projection.",
    );
  }
  return {
    id,
    amount: amount as number,
    amountReceived: amountReceived as number,
    currency,
    status,
    orderId,
    attemptId,
    intentToken: typeof clientSecret === "string" ? clientSecret : null,
  };
}

function requireRefund(value: unknown): StripeRefund {
  if (!isRecord(value) || ownData(value, "object") !== "refund") {
    throw new NpShopPaymentProviderError("stripe_invalid_response", "Stripe returned no refund.");
  }
  const id = boundedText(ownData(value, "id"));
  const paymentIntentId = boundedText(ownData(value, "payment_intent"));
  const currency = boundedText(ownData(value, "currency"), 3);
  const status = boundedText(ownData(value, "status"), 40);
  const amount = ownData(value, "amount");
  const created = ownData(value, "created");
  if (
    !id ||
    !refundPattern.test(id) ||
    !paymentIntentId ||
    !paymentIntentPattern.test(paymentIntentId) ||
    !currency ||
    !currencyPattern.test(currency) ||
    !status ||
    !Number.isSafeInteger(amount) ||
    (amount as number) < 1 ||
    !Number.isSafeInteger(created) ||
    (created as number) < 1
  ) {
    throw new NpShopPaymentProviderError(
      "stripe_invalid_response",
      "Stripe returned a malformed refund projection.",
    );
  }
  return {
    id,
    paymentIntentId,
    amount: amount as number,
    currency,
    created: created as number,
    status,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const maximum = 64 * 1_024;
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel().catch(() => undefined);
          throw new NpShopPaymentProviderError(
            "stripe_response_too_large",
            "Stripe returned an oversized response.",
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof NpShopPaymentProviderError) throw error;
      throw new NpShopPaymentProviderError(
        "stripe_unavailable",
        "Stripe closed the response before it could be verified.",
      );
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new NpShopPaymentProviderError(
      "stripe_invalid_response",
      "Stripe returned invalid JSON.",
    );
  }
}

function stripeError(payload: unknown, fallback: string, retryable: boolean) {
  const error = isRecord(payload) ? ownData(payload, "error") : null;
  const code = isRecord(error) ? boundedText(ownData(error, "code"), 80) : null;
  return new NpShopPaymentProviderError(
    code && /^[a-z0-9_]+$/u.test(code)
      ? `stripe_${code.replaceAll("_", "-")}`
      : "stripe_request_failed",
    fallback,
    retryable,
  );
}

function form(input: Record<string, string | number | boolean>): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) result.set(key, String(value));
  return result;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function paymentEventId(paymentIntentId: string, status: string): string {
  return `payment:${createHash("sha256").update(`${paymentIntentId}:${status}`).digest("hex")}`;
}

function adjustmentEventId(
  paymentIntentId: string,
  remainingAmountMinor: number,
  cancellations: NpShopVerifiedPaymentAdjustmentEvent["cancellations"],
): string {
  return `adjustment:${createHash("sha256")
    .update(JSON.stringify({ paymentIntentId, remainingAmountMinor, cancellations }))
    .digest("hex")}`;
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | null {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return value;
  }
  return null;
}

function verifyStripeSignature(
  input: NpShopPaymentWebhookInput,
  webhookSecret: string,
): { payload: unknown; signedAt: string } | null {
  const header = headerValue(input.headers, "stripe-signature");
  if (!header || header.length > 2_048) return null;
  const timestamps: string[] = [];
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamps.push(value);
    if (key === "v1") signatures.push(value);
  }
  if (timestamps.length !== 1 || signatures.length < 1 || signatures.length > 20) return null;
  const timestamp = timestamps[0];
  if (!/^\d{10,12}$/u.test(timestamp)) return null;
  const seconds = Number(timestamp);
  const received = new Date(input.receivedAt).getTime();
  if (!Number.isSafeInteger(seconds) || Number.isNaN(received)) return null;
  const signedMillis = seconds * 1_000;
  if (signedMillis < received - 300_000 || signedMillis > received + 30_000) return null;
  const expected = createHmac("sha256", webhookSecret)
    .update(timestamp)
    .update(".")
    .update(input.rawBody)
    .digest("hex");
  if (
    !signatures.some(
      (candidate) => /^[0-9a-f]{64}$/u.test(candidate) && constantTimeEqual(candidate, expected),
    )
  ) {
    return null;
  }
  try {
    return {
      payload: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody),
      ) as unknown,
      signedAt: new Date(signedMillis).toISOString(),
    };
  } catch {
    return null;
  }
}

export function createStripePaymentsAdapter(
  options: NpStripePaymentsOptions,
): NpShopPaymentInitiationAdapter & NpShopPaymentRefundAdapter {
  const publishable = requireKey(options.publishableKey, "pk");
  const secret = requireKey(options.secretKey, "sk");
  if (publishable.mode !== secret.mode) {
    throw new Error("Stripe publishable and secret keys must use the same test/live mode.");
  }
  const webhookSecret = requireWebhookSecret(options.webhookSecret);
  const siteUrl = requireSiteUrl(options.siteUrl);
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("Stripe timeoutMs must be an integer from 1000 to 30000.");
  }
  const authorization = `Basic ${Buffer.from(`${secret.value}:`).toString("base64")}`;

  async function stripeRequest(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${STRIPE_API_ORIGIN}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          ...init.headers,
        },
      });
    } catch {
      throw new NpShopPaymentProviderError(
        "stripe_unavailable",
        "Stripe could not be reached. The Shop operation remains retryable.",
      );
    }
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500;
      throw stripeError(payload, "Stripe rejected the request.", retryable);
    }
    return payload;
  }

  async function readPaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent> {
    const payload = await stripeRequest(
      `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      { method: "GET" },
    );
    return requirePaymentIntent(payload);
  }

  async function preparePayment(
    input: NpShopPaymentPrepareInput,
  ): Promise<NpShopPaymentPrepareResult> {
    if (input.amountMinor < 1 || input.amountMinor > 99_999_999) {
      throw new NpShopPaymentProviderError(
        "stripe_amount_unsupported",
        "Stripe requires a positive payment amount of at most eight digits.",
        false,
      );
    }
    const payload = await stripeRequest("/v1/payment_intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": input.attemptId,
      },
      body: form({
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        "automatic_payment_methods[enabled]": true,
        "metadata[nexpress_order_id]": input.orderId,
        "metadata[nexpress_attempt_id]": input.attemptId,
        description: input.orderName,
      }).toString(),
    });
    const payment = requirePaymentIntent(payload, true);
    if (
      payment.orderId !== input.orderId ||
      payment.attemptId !== input.attemptId ||
      payment.amount !== input.amountMinor ||
      payment.currency !== input.currency.toLowerCase() ||
      payment.status !== "requires_payment_method" ||
      !payment.intentToken
    ) {
      throw new NpShopPaymentProviderError(
        "stripe_prepare_mismatch",
        "Stripe created a PaymentIntent that does not match the exact Shop attempt.",
        false,
      );
    }
    return {
      kind: "client",
      data: {
        sdkUrl: STRIPE_SDK_URL,
        publishableKey: publishable.value,
        paymentIntentId: payment.id,
        intentToken: payment.intentToken,
        orderId: input.orderId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        returnUrl: new URL(input.successPath, siteUrl).toString(),
      },
    };
  }

  async function confirmPayment(
    input: NpShopPaymentConfirmAdapterInput,
  ): Promise<NpShopVerifiedPaymentEvent> {
    const confirmation = input.confirmation;
    if (Object.keys(confirmation).length !== 1 || !Object.hasOwn(confirmation, "paymentIntentId")) {
      throw new NpShopPaymentProviderError(
        "stripe_invalid_confirmation",
        "The Stripe confirmation payload is invalid.",
        false,
      );
    }
    const paymentIntentId = boundedText(confirmation.paymentIntentId);
    const handoffData = input.attempt.handoff.kind === "client" ? input.attempt.handoff.data : null;
    const storedPaymentIntentId = handoffData ? boundedText(handoffData.paymentIntentId) : null;
    if (
      !paymentIntentId ||
      !paymentIntentPattern.test(paymentIntentId) ||
      !storedPaymentIntentId ||
      !constantTimeEqual(paymentIntentId, storedPaymentIntentId)
    ) {
      throw new NpShopPaymentProviderError(
        "stripe_confirmation_mismatch",
        "The Stripe return did not match the stored payment attempt.",
        false,
      );
    }
    const payment = await readPaymentIntent(paymentIntentId);
    if (
      payment.status !== "succeeded" ||
      payment.orderId !== input.attempt.orderId ||
      payment.attemptId !== input.attempt.id ||
      payment.amount !== input.attempt.amountMinor ||
      payment.amountReceived !== input.attempt.amountMinor ||
      payment.currency !== input.attempt.currency.toLowerCase()
    ) {
      throw new NpShopPaymentProviderError(
        "stripe_confirmation_mismatch",
        "Stripe did not confirm the exact Shop payment.",
        false,
      );
    }
    return {
      contract: NP_SHOP_PAYMENT_EVENT_CONTRACT,
      eventId: paymentEventId(payment.id, payment.status),
      type: "payment.succeeded",
      orderId: payment.orderId,
      paymentReference: payment.id,
      currency: input.attempt.currency,
      amountMinor: payment.amount,
      signedAt: input.receivedAt,
    };
  }

  async function refundPayment(
    input: NpShopPaymentRefundInput,
  ): Promise<NpShopPaymentRefundResult> {
    if (!paymentIntentPattern.test(input.paymentReference) || input.amountMinor < 1) {
      throw new NpShopPaymentProviderError(
        "stripe_refund_unsupported",
        "Stripe requires an exact positive PaymentIntent full refund.",
        false,
      );
    }
    const payload = await stripeRequest("/v1/refunds", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": input.refundId,
      },
      body: form({
        payment_intent: input.paymentReference,
        amount: input.amountMinor,
        reason: "requested_by_customer",
        "metadata[nexpress_refund_id]": input.refundId,
        "metadata[nexpress_order_id]": input.orderId,
      }).toString(),
    });
    const refund = requireRefund(payload);
    if (
      refund.status !== "succeeded" ||
      refund.paymentIntentId !== input.paymentReference ||
      refund.amount !== input.amountMinor ||
      refund.currency !== input.currency.toLowerCase()
    ) {
      throw new NpShopPaymentProviderError(
        "stripe_refund_mismatch",
        "Stripe did not return the exact completed Shop refund.",
        refund.status !== "failed" && refund.status !== "canceled",
      );
    }
    return {
      contract: NP_SHOP_REFUND_RESULT_CONTRACT,
      refundId: input.refundId,
      orderId: input.orderId,
      paymentReference: refund.paymentIntentId,
      refundReference: refund.id,
      currency: input.currency,
      amountMinor: refund.amount,
      refundedAt: new Date(refund.created * 1_000).toISOString(),
    };
  }

  async function adjustmentFromPaymentIntent(
    paymentIntentId: string,
    signedAt: string,
  ): Promise<NpShopVerifiedPaymentAdjustmentEvent | NpShopIgnoredPaymentWebhook> {
    const [payment, listPayload] = await Promise.all([
      readPaymentIntent(paymentIntentId),
      stripeRequest(
        `/v1/refunds?${form({ payment_intent: paymentIntentId, limit: 100 }).toString()}`,
        {
          method: "GET",
        },
      ),
    ]);
    if (
      !isRecord(listPayload) ||
      ownData(listPayload, "object") !== "list" ||
      !Array.isArray(ownData(listPayload, "data"))
    ) {
      throw new NpShopPaymentProviderError(
        "stripe_adjustment_mismatch",
        "Stripe returned a malformed refund list.",
        false,
      );
    }
    if (ownData(listPayload, "has_more") !== false) {
      throw new NpShopPaymentProviderError(
        "stripe_adjustment_limit",
        "Stripe returned more refunds than the bounded Shop adjustment contract accepts.",
        false,
      );
    }
    const refundData = ownData(listPayload, "data") as unknown[];
    if (refundData.length > 100) {
      throw new NpShopPaymentProviderError(
        "stripe_adjustment_limit",
        "Stripe returned more refunds than the bounded Shop adjustment contract accepts.",
        false,
      );
    }
    const refunds = refundData.map(requireRefund);
    if (
      refunds.some(
        (refund) => refund.paymentIntentId !== payment.id || refund.currency !== payment.currency,
      )
    ) {
      throw new NpShopPaymentProviderError(
        "stripe_adjustment_mismatch",
        "Stripe returned refunds from a different payment.",
        false,
      );
    }
    const completed = refunds.filter((refund) => refund.status === "succeeded");
    if (completed.length === 0) {
      return {
        contract: NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT,
        ignored: true,
        reason: "non-terminal",
      };
    }
    const cancellations = completed
      .map((refund) => ({
        reference: refund.id,
        amountMinor: refund.amount,
        cancelledAt: new Date(refund.created * 1_000).toISOString(),
      }))
      .sort(
        (left, right) =>
          left.cancelledAt.localeCompare(right.cancelledAt) ||
          left.reference.localeCompare(right.reference),
      );
    const reversed = cancellations.reduce((total, item) => total + item.amountMinor, 0);
    const references = new Set(cancellations.map((item) => item.reference));
    if (
      references.size !== cancellations.length ||
      !Number.isSafeInteger(reversed) ||
      reversed < 1 ||
      reversed > payment.amount ||
      payment.status !== "succeeded" ||
      payment.amountReceived !== payment.amount
    ) {
      throw new NpShopPaymentProviderError(
        "stripe_adjustment_mismatch",
        "Stripe refund totals do not match the authoritative PaymentIntent.",
        false,
      );
    }
    const remainingAmountMinor = payment.amount - reversed;
    return {
      contract: NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT,
      eventId: adjustmentEventId(payment.id, remainingAmountMinor, cancellations),
      orderId: payment.orderId,
      paymentReference: payment.id,
      currency: payment.currency.toUpperCase() as NpShopVerifiedPaymentAdjustmentEvent["currency"],
      originalAmountMinor: payment.amount,
      remainingAmountMinor,
      cancellations,
      signedAt,
    };
  }

  async function verifyWebhook(
    input: NpShopPaymentWebhookInput,
  ): Promise<NpShopPaymentWebhookResult> {
    const verified = verifyStripeSignature(input, webhookSecret);
    if (!verified || !isRecord(verified.payload)) return null;
    if (ownData(verified.payload, "object") !== "event") return null;
    const eventId = boundedText(ownData(verified.payload, "id"));
    const eventType = boundedText(ownData(verified.payload, "type"), 80);
    const data = ownData(verified.payload, "data");
    const object = isRecord(data) ? ownData(data, "object") : null;
    if (!eventId || !stripeEventPattern.test(eventId) || !eventType || !isRecord(object))
      return null;

    if (eventType === "payment_intent.succeeded" || eventType === "payment_intent.canceled") {
      const payment = requirePaymentIntent(object);
      if (
        eventType === "payment_intent.succeeded" &&
        (payment.status !== "succeeded" || payment.amountReceived !== payment.amount)
      )
        return null;
      if (eventType === "payment_intent.canceled" && payment.status !== "canceled") return null;
      return {
        contract: NP_SHOP_PAYMENT_EVENT_CONTRACT,
        eventId: paymentEventId(payment.id, payment.status),
        type: eventType === "payment_intent.succeeded" ? "payment.succeeded" : "payment.failed",
        orderId: payment.orderId,
        paymentReference: payment.id,
        currency: payment.currency.toUpperCase() as NpShopVerifiedPaymentEvent["currency"],
        amountMinor: payment.amount,
        signedAt: verified.signedAt,
      };
    }

    if (["refund.created", "refund.updated", "charge.refunded"].includes(eventType)) {
      const candidate = boundedText(ownData(object, "payment_intent"));
      const pattern = eventType === "charge.refunded" ? chargePattern : refundPattern;
      const objectId = boundedText(ownData(object, "id"));
      if (
        !objectId ||
        !pattern.test(objectId) ||
        !candidate ||
        !paymentIntentPattern.test(candidate)
      )
        return null;
      return adjustmentFromPaymentIntent(candidate, verified.signedAt);
    }

    return {
      contract: NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT,
      ignored: true,
      reason: "unsupported-event",
    };
  }

  return Object.freeze({
    id: "stripe",
    preparePayment,
    confirmPayment,
    verifyWebhook,
    refundPayment,
    renderPaymentLauncher: (props: NpShopPaymentLauncherProps) => (
      <StripePaymentLauncher {...props} />
    ),
  });
}

export function stripePaymentsFromEnv(input: {
  siteUrl: string;
  fetch?: typeof fetch;
}): NpShopPaymentInitiationAdapter & NpShopPaymentRefundAdapter {
  const publishableKey = process.env.NP_STRIPE_PUBLISHABLE_KEY;
  const secretKey = process.env.NP_STRIPE_SECRET_KEY;
  const webhookSecret = process.env.NP_STRIPE_WEBHOOK_SECRET;
  if (!publishableKey || !secretKey || !webhookSecret) {
    throw new Error(
      "Set NP_STRIPE_PUBLISHABLE_KEY, NP_STRIPE_SECRET_KEY, and NP_STRIPE_WEBHOOK_SECRET before enabling Stripe.",
    );
  }
  return createStripePaymentsAdapter({
    ...input,
    publishableKey,
    secretKey,
    webhookSecret,
  });
}

import { createHash, timingSafeEqual } from "node:crypto";

import {
  NP_SHOP_PAYMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT,
  NpShopPaymentProviderError,
  type NpShopIgnoredPaymentWebhook,
  type NpShopPaymentConfirmAdapterInput,
  type NpShopPaymentInitiationAdapter,
  type NpShopPaymentLauncherProps,
  type NpShopPaymentPrepareInput,
  type NpShopPaymentPrepareResult,
  type NpShopPaymentWebhookInput,
  type NpShopPaymentWebhookResult,
  type NpShopVerifiedPaymentEvent,
} from "@nexpress/plugin-shop";
import { TossPaymentLauncher } from "@nexpress/shop-payment-toss/client";

const TOSS_SDK_URL = "https://js.tosspayments.com/v2/standard";
const TOSS_API_ORIGIN = "https://api.tosspayments.com";
const keyPattern = /^(test|live)_(g?ck|g?sk)_[A-Za-z0-9_-]{8,180}$/u;
const opaquePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export interface NpTossPaymentsOptions {
  clientKey: string;
  secretKey: string;
  siteUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface TossPaymentProjection {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  currency: "KRW";
}

function requireKey(
  value: string,
  kind: "ck" | "sk",
): { value: string; mode: string; family: "individual" | "widget" } {
  const match = keyPattern.exec(value);
  if (!match || (match[2] !== kind && match[2] !== `g${kind}`)) {
    throw new Error(`Toss Payments ${kind === "ck" ? "client" : "secret"} key is invalid.`);
  }
  return { value, mode: match[1], family: match[2].startsWith("g") ? "widget" : "individual" };
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
    throw new Error("Toss Payments siteUrl must be one canonical HTTPS origin.");
  }
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum = 200): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function requirePaymentProjection(value: unknown): TossPaymentProjection {
  if (!isRecord(value)) {
    throw new NpShopPaymentProviderError("toss_invalid_response", "Toss returned no payment.");
  }
  const paymentKey = boundedText(value.paymentKey);
  const orderId = boundedText(value.orderId);
  const status = boundedText(value.status, 40);
  if (
    !paymentKey ||
    !opaquePattern.test(paymentKey) ||
    !orderId ||
    !status ||
    !Number.isSafeInteger(value.totalAmount) ||
    (value.totalAmount as number) < 0 ||
    value.currency !== "KRW"
  ) {
    throw new NpShopPaymentProviderError(
      "toss_invalid_response",
      "Toss returned a malformed payment projection.",
    );
  }
  return {
    paymentKey,
    orderId,
    status,
    totalAmount: value.totalAmount as number,
    currency: "KRW",
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const maximum = 64 * 1_024;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel().catch(() => undefined);
          throw new NpShopPaymentProviderError(
            "toss_response_too_large",
            "Toss returned an oversized response.",
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof NpShopPaymentProviderError) throw error;
      throw new NpShopPaymentProviderError(
        "toss_unavailable",
        "Toss Payments closed the response before it could be verified.",
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
    throw new NpShopPaymentProviderError("toss_invalid_response", "Toss returned invalid JSON.");
  }
}

function safeProviderError(value: unknown, fallback: string): NpShopPaymentProviderError {
  const code = isRecord(value) ? boundedText(value.code, 80) : null;
  return new NpShopPaymentProviderError(
    code && /^[A-Z0-9_]+$/u.test(code) ? `toss_${code.toLowerCase()}` : "toss_request_failed",
    fallback,
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function paymentEventId(paymentKey: string, status: string): string {
  return `payment:${createHash("sha256").update(`${paymentKey}:${status}`).digest("hex")}`;
}

export function createTossPaymentsAdapter(
  options: NpTossPaymentsOptions,
): NpShopPaymentInitiationAdapter {
  const client = requireKey(options.clientKey, "ck");
  const secret = requireKey(options.secretKey, "sk");
  if (client.mode !== secret.mode || client.family !== secret.family) {
    throw new Error(
      "Toss Payments client and secret keys must use the same test/live mode and key family.",
    );
  }
  const siteUrl = requireSiteUrl(options.siteUrl);
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("Toss Payments timeoutMs must be an integer from 1000 to 30000.");
  }
  const authorization = `Basic ${Buffer.from(`${secret.value}:`).toString("base64")}`;

  async function tossRequest(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetcher(`${TOSS_API_ORIGIN}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Accept-Language": "en-US",
          ...init.headers,
        },
      });
    } catch {
      throw new NpShopPaymentProviderError(
        "toss_unavailable",
        "Toss Payments could not be reached. The order remains pending.",
      );
    }
  }

  async function queryPayment(paymentKey: string): Promise<TossPaymentProjection> {
    const response = await tossRequest(`/v1/payments/${encodeURIComponent(paymentKey)}`, {
      method: "GET",
    });
    const payload = await readBoundedJson(response);
    if (!response.ok) throw safeProviderError(payload, "Toss could not verify the payment.");
    return requirePaymentProjection(payload);
  }

  function preparePayment(input: NpShopPaymentPrepareInput): NpShopPaymentPrepareResult {
    if (input.currency !== "KRW") {
      throw new NpShopPaymentProviderError(
        "toss_currency_unsupported",
        "Toss Payments standard checkout supports KRW orders only.",
        false,
      );
    }
    if (input.amountMinor < 1) {
      throw new NpShopPaymentProviderError(
        "toss_amount_unsupported",
        "Toss Payments requires a positive payment amount.",
        false,
      );
    }
    return {
      kind: "client",
      data: {
        sdkUrl: TOSS_SDK_URL,
        clientKey: client.value,
        customerKey: "ANONYMOUS",
        method: "CARD",
        orderId: input.orderId,
        orderName: input.orderName,
        amountMinor: input.amountMinor,
        currency: input.currency,
        successUrl: new URL(input.successPath, siteUrl).toString(),
        failUrl: new URL(input.failPath, siteUrl).toString(),
      },
    };
  }

  async function confirmPayment(
    input: NpShopPaymentConfirmAdapterInput,
  ): Promise<NpShopVerifiedPaymentEvent> {
    const confirmation = input.confirmation;
    const keys = Object.keys(confirmation);
    if (
      keys.length !== 3 ||
      !keys.every((key) => ["paymentKey", "orderId", "amount"].includes(key))
    ) {
      throw new NpShopPaymentProviderError(
        "toss_invalid_confirmation",
        "The Toss confirmation payload is invalid.",
        false,
      );
    }
    const paymentKey = boundedText(confirmation.paymentKey);
    const returnedOrderId = boundedText(confirmation.orderId);
    const returnedAmount = confirmation.amount;
    if (
      !paymentKey ||
      !opaquePattern.test(paymentKey) ||
      returnedOrderId !== input.attempt.orderId ||
      returnedAmount !== input.attempt.amountMinor
    ) {
      throw new NpShopPaymentProviderError(
        "toss_confirmation_mismatch",
        "The Toss return did not match the stored order and amount.",
        false,
      );
    }
    const response = await tossRequest("/v1/payments/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.attempt.id,
      },
      body: JSON.stringify({
        paymentKey,
        orderId: input.attempt.orderId,
        amount: input.attempt.amountMinor,
      }),
    });
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      throw safeProviderError(
        payload,
        "Toss did not confirm the payment. The order remains pending and may be retried.",
      );
    }
    const payment = requirePaymentProjection(payload);
    if (
      payment.status !== "DONE" ||
      payment.orderId !== input.attempt.orderId ||
      payment.totalAmount !== input.attempt.amountMinor ||
      payment.currency !== input.attempt.currency ||
      !constantTimeEqual(payment.paymentKey, paymentKey)
    ) {
      throw new NpShopPaymentProviderError(
        "toss_confirmation_mismatch",
        "Toss confirmed a payment that does not match the exact Shop order.",
        false,
      );
    }
    return {
      contract: NP_SHOP_PAYMENT_EVENT_CONTRACT,
      eventId: paymentEventId(payment.paymentKey, payment.status),
      type: "payment.succeeded",
      orderId: payment.orderId,
      paymentReference: payment.paymentKey,
      currency: payment.currency,
      amountMinor: payment.totalAmount,
      signedAt: input.receivedAt,
    };
  }

  async function verifyWebhook(
    input: NpShopPaymentWebhookInput,
  ): Promise<NpShopPaymentWebhookResult> {
    let payload: unknown;
    try {
      payload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody),
      ) as unknown;
    } catch {
      return null;
    }
    if (!isRecord(payload) || payload.eventType !== "PAYMENT_STATUS_CHANGED") {
      return null;
    }
    const data = payload.data;
    if (!isRecord(data)) return null;
    const paymentKey = boundedText(data.paymentKey);
    if (!paymentKey || !opaquePattern.test(paymentKey)) return null;
    const payment = await queryPayment(paymentKey);
    if (
      !constantTimeEqual(payment.paymentKey, paymentKey) ||
      data.orderId !== payment.orderId ||
      data.status !== payment.status ||
      data.totalAmount !== payment.totalAmount ||
      data.currency !== payment.currency
    ) {
      return null;
    }
    const type =
      payment.status === "DONE"
        ? "payment.succeeded"
        : payment.status === "ABORTED" || payment.status === "EXPIRED"
          ? "payment.failed"
          : null;
    if (!type) {
      return {
        contract: NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT,
        ignored: true,
        reason: "non-terminal",
      } satisfies NpShopIgnoredPaymentWebhook;
    }
    const eventId = paymentEventId(payment.paymentKey, payment.status);
    return {
      contract: NP_SHOP_PAYMENT_EVENT_CONTRACT,
      eventId,
      type,
      orderId: payment.orderId,
      paymentReference: payment.paymentKey,
      currency: payment.currency,
      amountMinor: payment.totalAmount,
      signedAt: input.receivedAt,
    };
  }

  return Object.freeze({
    id: "toss-payments",
    preparePayment,
    confirmPayment,
    verifyWebhook,
    renderPaymentLauncher: (props: NpShopPaymentLauncherProps) => (
      <TossPaymentLauncher {...props} />
    ),
  });
}

export function tossPaymentsFromEnv(input: {
  siteUrl: string;
  fetch?: typeof fetch;
}): NpShopPaymentInitiationAdapter {
  const clientKey = process.env.NP_TOSS_PAYMENTS_CLIENT_KEY;
  const secretKey = process.env.NP_TOSS_PAYMENTS_SECRET_KEY;
  if (!clientKey || !secretKey) {
    throw new Error(
      "Set both NP_TOSS_PAYMENTS_CLIENT_KEY and NP_TOSS_PAYMENTS_SECRET_KEY before enabling Toss Payments.",
    );
  }
  return createTossPaymentsAdapter({ ...input, clientKey, secretKey });
}

export { TOSS_API_ORIGIN, TOSS_SDK_URL };

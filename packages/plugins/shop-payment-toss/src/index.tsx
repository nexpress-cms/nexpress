import { createHash, timingSafeEqual } from "node:crypto";

import {
  NP_SHOP_PAYMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_WEBHOOK_IGNORED_CONTRACT,
  NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT,
  NP_SHOP_REFUND_RESULT_CONTRACT,
  NpShopPaymentProviderError,
  type NpShopIgnoredPaymentWebhook,
  type NpShopPaymentConfirmAdapterInput,
  type NpShopPaymentInitiationAdapter,
  type NpShopPaymentPartialRefundAdapter,
  type NpShopPaymentPartialRefundInput,
  type NpShopPaymentPartialRefundResult,
  type NpShopPaymentReturnSettlementAdapter,
  type NpShopPaymentReturnSettlementRefundInput,
  type NpShopPaymentRefundAdapter,
  type NpShopPaymentRefundInput,
  type NpShopPaymentRefundResult,
  type NpShopPaymentLauncherProps,
  type NpShopPaymentPrepareInput,
  type NpShopPaymentPrepareResult,
  type NpShopPaymentWebhookInput,
  type NpShopPaymentWebhookResult,
  type NpShopVerifiedPaymentEvent,
  type NpShopVerifiedPaymentAdjustmentEvent,
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

interface TossFullCancellationProjection extends TossPaymentProjection {
  status: "CANCELED";
  balanceAmount: 0;
  transactionKey: string;
  canceledAt: string;
}

interface TossPartialCancellationProjection extends TossPaymentProjection {
  status: "PARTIAL_CANCELED";
  balanceAmount: number;
  transactionKey: string;
  canceledAt: string;
}

interface TossCancellationSnapshot extends TossPaymentProjection {
  status: "CANCELED" | "PARTIAL_CANCELED";
  balanceAmount: number;
  cancellations: NpShopVerifiedPaymentAdjustmentEvent["cancellations"];
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

function requireFullCancellationProjection(value: unknown): TossFullCancellationProjection {
  const payment = requirePaymentProjection(value);
  if (
    payment.status !== "CANCELED" ||
    !isRecord(value) ||
    value.balanceAmount !== 0 ||
    !Array.isArray(value.cancels) ||
    value.cancels.length < 1
  ) {
    throw new NpShopPaymentProviderError(
      "toss_refund_mismatch",
      "Toss did not return one fully cancelled payment.",
      false,
    );
  }
  const completed = value.cancels.filter(
    (cancel): cancel is Record<string, unknown> =>
      isRecord(cancel) &&
      cancel.cancelStatus === "DONE" &&
      cancel.cancelAmount === payment.totalAmount &&
      cancel.refundableAmount === 0,
  );
  const cancel = completed.length === 1 ? completed[0] : null;
  const transactionKey = cancel ? boundedText(cancel.transactionKey, 64) : null;
  const canceledAtValue = cancel ? boundedText(cancel.canceledAt, 40) : null;
  const canceledAt = canceledAtValue ? new Date(canceledAtValue) : null;
  if (
    !transactionKey ||
    !opaquePattern.test(transactionKey) ||
    !canceledAt ||
    Number.isNaN(canceledAt.getTime())
  ) {
    throw new NpShopPaymentProviderError(
      "toss_refund_mismatch",
      "Toss returned malformed full-cancellation metadata.",
      false,
    );
  }
  return {
    ...payment,
    status: "CANCELED",
    balanceAmount: 0,
    transactionKey,
    canceledAt: canceledAt.toISOString(),
  };
}

function requirePartialCancellationProjection(
  value: unknown,
  amountMinor: number,
): TossPartialCancellationProjection {
  const payment = requirePaymentProjection(value);
  if (
    payment.status !== "PARTIAL_CANCELED" ||
    !isRecord(value) ||
    !Number.isSafeInteger(value.balanceAmount) ||
    (value.balanceAmount as number) < 1 ||
    payment.totalAmount - (value.balanceAmount as number) !== amountMinor ||
    !Array.isArray(value.cancels) ||
    value.cancels.length < 1
  ) {
    throw new NpShopPaymentProviderError(
      "toss_partial_refund_mismatch",
      "Toss did not return the exact first partial cancellation.",
      false,
    );
  }
  const completed = value.cancels.filter(
    (cancel): cancel is Record<string, unknown> =>
      isRecord(cancel) &&
      cancel.cancelStatus === "DONE" &&
      cancel.cancelAmount === amountMinor &&
      cancel.refundableAmount === value.balanceAmount,
  );
  const cancel = completed.length === 1 ? completed[0] : null;
  const transactionKey = cancel ? boundedText(cancel.transactionKey, 64) : null;
  const canceledAtValue = cancel ? boundedText(cancel.canceledAt, 40) : null;
  const canceledAt = canceledAtValue ? new Date(canceledAtValue) : null;
  if (
    !transactionKey ||
    !opaquePattern.test(transactionKey) ||
    !canceledAt ||
    Number.isNaN(canceledAt.getTime())
  ) {
    throw new NpShopPaymentProviderError(
      "toss_partial_refund_mismatch",
      "Toss returned malformed partial-cancellation metadata.",
      false,
    );
  }
  return {
    ...payment,
    status: "PARTIAL_CANCELED",
    balanceAmount: value.balanceAmount as number,
    transactionKey,
    canceledAt: canceledAt.toISOString(),
  };
}

function requireCancellationSnapshot(value: unknown): TossCancellationSnapshot {
  const payment = requirePaymentProjection(value);
  if (
    (payment.status !== "CANCELED" && payment.status !== "PARTIAL_CANCELED") ||
    !isRecord(value) ||
    !Number.isSafeInteger(value.balanceAmount) ||
    (value.balanceAmount as number) < 0 ||
    (value.balanceAmount as number) >= payment.totalAmount ||
    !Array.isArray(value.cancels) ||
    value.cancels.length < 1 ||
    value.cancels.length > 100
  ) {
    throw new NpShopPaymentProviderError(
      "toss_adjustment_mismatch",
      "Toss returned a malformed captured-payment cancellation snapshot.",
      false,
    );
  }
  const cancellations = value.cancels
    .filter((candidate): candidate is Record<string, unknown> => {
      return isRecord(candidate) && candidate.cancelStatus === "DONE";
    })
    .map((candidate) => {
      const reference = boundedText(candidate.transactionKey, 200);
      const cancelledAtValue = boundedText(candidate.canceledAt, 40);
      const cancelledAt = cancelledAtValue ? new Date(cancelledAtValue) : null;
      if (
        !reference ||
        !opaquePattern.test(reference) ||
        !Number.isSafeInteger(candidate.cancelAmount) ||
        (candidate.cancelAmount as number) < 1 ||
        !cancelledAt ||
        Number.isNaN(cancelledAt.getTime())
      ) {
        throw new NpShopPaymentProviderError(
          "toss_adjustment_mismatch",
          "Toss returned malformed completed-cancellation metadata.",
          false,
        );
      }
      return {
        reference,
        amountMinor: candidate.cancelAmount as number,
        cancelledAt: cancelledAt.toISOString(),
      };
    })
    .sort((left, right) => {
      return (
        left.cancelledAt.localeCompare(right.cancelledAt) ||
        left.reference.localeCompare(right.reference)
      );
    });
  const references = new Set(cancellations.map((item) => item.reference));
  const reversed = cancellations.reduce((total, item) => total + item.amountMinor, 0);
  if (
    cancellations.length < 1 ||
    references.size !== cancellations.length ||
    !Number.isSafeInteger(reversed) ||
    reversed !== payment.totalAmount - (value.balanceAmount as number) ||
    (payment.status === "CANCELED" && value.balanceAmount !== 0) ||
    (payment.status === "PARTIAL_CANCELED" && (value.balanceAmount as number) < 1)
  ) {
    throw new NpShopPaymentProviderError(
      "toss_adjustment_mismatch",
      "Toss cancellation totals do not match the authoritative payment balance.",
      false,
    );
  }
  return {
    ...payment,
    status: payment.status,
    balanceAmount: value.balanceAmount as number,
    cancellations,
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

function safeProviderError(
  value: unknown,
  fallback: string,
  retryable = true,
): NpShopPaymentProviderError {
  const code = isRecord(value) ? boundedText(value.code, 80) : null;
  return new NpShopPaymentProviderError(
    code && /^[A-Z0-9_]+$/u.test(code) ? `toss_${code.toLowerCase()}` : "toss_request_failed",
    fallback,
    retryable,
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

function paymentAdjustmentEventId(payment: TossCancellationSnapshot): string {
  return `adjustment:${createHash("sha256")
    .update(
      JSON.stringify({
        paymentKey: payment.paymentKey,
        balanceAmount: payment.balanceAmount,
        cancellations: payment.cancellations,
      }),
    )
    .digest("hex")}`;
}

export function createTossPaymentsAdapter(
  options: NpTossPaymentsOptions,
): NpShopPaymentInitiationAdapter &
  NpShopPaymentRefundAdapter &
  NpShopPaymentPartialRefundAdapter &
  NpShopPaymentReturnSettlementAdapter {
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

  async function queryPayment(paymentKey: string): Promise<{
    payment: TossPaymentProjection;
    payload: unknown;
  }> {
    const response = await tossRequest(`/v1/payments/${encodeURIComponent(paymentKey)}`, {
      method: "GET",
    });
    const payload = await readBoundedJson(response);
    if (!response.ok) throw safeProviderError(payload, "Toss could not verify the payment.");
    return { payment: requirePaymentProjection(payload), payload };
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

  async function refundPayment(
    input: NpShopPaymentRefundInput,
  ): Promise<NpShopPaymentRefundResult> {
    if (input.currency !== "KRW" || input.amountMinor < 1) {
      throw new NpShopPaymentProviderError(
        "toss_refund_unsupported",
        "Toss Payments supports only positive KRW full refunds for this adapter.",
        false,
      );
    }
    const response = await tossRequest(
      `/v1/payments/${encodeURIComponent(input.paymentReference)}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.refundId,
        },
        body: JSON.stringify({ cancelReason: input.reason }),
      },
    );
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      throw safeProviderError(payload, "Toss did not cancel the entire payment.", retryable);
    }
    const payment = requireFullCancellationProjection(payload);
    if (
      payment.orderId !== input.orderId ||
      payment.totalAmount !== input.amountMinor ||
      payment.currency !== input.currency ||
      !constantTimeEqual(payment.paymentKey, input.paymentReference)
    ) {
      throw new NpShopPaymentProviderError(
        "toss_refund_mismatch",
        "Toss cancelled a payment that does not match the exact Shop refund.",
        false,
      );
    }
    return {
      contract: NP_SHOP_REFUND_RESULT_CONTRACT,
      refundId: input.refundId,
      orderId: payment.orderId,
      paymentReference: payment.paymentKey,
      refundReference: payment.transactionKey,
      currency: payment.currency,
      amountMinor: payment.totalAmount,
      refundedAt: payment.canceledAt,
    };
  }

  async function refundPaymentPartially(
    input: NpShopPaymentPartialRefundInput,
  ): Promise<NpShopPaymentPartialRefundResult> {
    if (input.currency !== "KRW" || input.amountMinor < 1) {
      throw new NpShopPaymentProviderError(
        "toss_partial_refund_unsupported",
        "Toss Payments supports only positive KRW partial refunds for this adapter.",
        false,
      );
    }
    const response = await tossRequest(
      `/v1/payments/${encodeURIComponent(input.paymentReference)}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.refundId,
        },
        body: JSON.stringify({ cancelReason: input.reason, cancelAmount: input.amountMinor }),
      },
    );
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      throw safeProviderError(payload, "Toss did not partially cancel the payment.", retryable);
    }
    const payment = requirePartialCancellationProjection(payload, input.amountMinor);
    if (
      payment.orderId !== input.orderId ||
      payment.currency !== input.currency ||
      !constantTimeEqual(payment.paymentKey, input.paymentReference)
    ) {
      throw new NpShopPaymentProviderError(
        "toss_partial_refund_mismatch",
        "Toss partially cancelled a payment that does not match the Shop refund.",
        false,
      );
    }
    return {
      contract: NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT,
      refundId: input.refundId,
      orderId: payment.orderId,
      returnId: input.returnId,
      paymentReference: payment.paymentKey,
      refundReference: payment.transactionKey,
      currency: payment.currency,
      amountMinor: input.amountMinor,
      refundedAt: payment.canceledAt,
    };
  }

  async function refundReturnSettlement(
    input: NpShopPaymentReturnSettlementRefundInput,
  ): Promise<NpShopPaymentPartialRefundResult> {
    const grossAmountMinor =
      input.allocation.itemAmountMinor + input.allocation.shippingMinor + input.allocation.taxMinor;
    if (
      input.postageSettlement.contract !== "np.shop-return-postage-settlement.v1" ||
      input.postageSettlement.method.contract !== "np.shop-return-postage-method.v1" ||
      !Number.isSafeInteger(grossAmountMinor) ||
      grossAmountMinor < 1 ||
      !Number.isSafeInteger(input.amountMinor) ||
      !Number.isSafeInteger(input.postageSettlement.method.amountMinor) ||
      !Number.isSafeInteger(input.postageSettlement.deductionMinor) ||
      !["merchant", "customer"].includes(input.postageSettlement.responsibility) ||
      input.postageSettlement.method.currency !== input.currency ||
      input.postageSettlement.deductionMinor < 0 ||
      input.postageSettlement.deductionMinor > grossAmountMinor ||
      input.amountMinor !== grossAmountMinor - input.postageSettlement.deductionMinor ||
      (input.postageSettlement.responsibility === "merchant" &&
        input.postageSettlement.deductionMinor !== 0) ||
      (input.postageSettlement.responsibility === "customer" &&
        input.postageSettlement.deductionMinor !== input.postageSettlement.method.amountMinor)
    ) {
      throw new NpShopPaymentProviderError(
        "toss_return_settlement_mismatch",
        "The Shop return-postage settlement does not match its exact refund amount.",
        false,
      );
    }
    return refundPaymentPartially(input);
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
    const queried = await queryPayment(paymentKey);
    const payment = queried.payment;
    if (
      !constantTimeEqual(payment.paymentKey, paymentKey) ||
      data.orderId !== payment.orderId ||
      data.status !== payment.status ||
      data.totalAmount !== payment.totalAmount ||
      data.currency !== payment.currency
    ) {
      return null;
    }
    if (payment.status === "CANCELED" || payment.status === "PARTIAL_CANCELED") {
      const cancellation = requireCancellationSnapshot(queried.payload);
      return {
        contract: NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT,
        eventId: paymentAdjustmentEventId(cancellation),
        orderId: cancellation.orderId,
        paymentReference: cancellation.paymentKey,
        currency: cancellation.currency,
        originalAmountMinor: cancellation.totalAmount,
        remainingAmountMinor: cancellation.balanceAmount,
        cancellations: cancellation.cancellations,
        signedAt: input.receivedAt,
      } satisfies NpShopVerifiedPaymentAdjustmentEvent;
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
    refundPayment,
    refundPaymentPartially,
    refundReturnSettlement,
    renderPaymentLauncher: (props: NpShopPaymentLauncherProps) => (
      <TossPaymentLauncher {...props} />
    ),
  });
}

export function tossPaymentsFromEnv(input: {
  siteUrl: string;
  fetch?: typeof fetch;
}): NpShopPaymentInitiationAdapter &
  NpShopPaymentRefundAdapter &
  NpShopPaymentPartialRefundAdapter &
  NpShopPaymentReturnSettlementAdapter {
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

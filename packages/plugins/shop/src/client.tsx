"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { npRequireMediaAttachmentWire } from "@nexpress/core/media-contract";

import { npRequireShopCartQuote } from "./cart-contract.js";
import { npRequireShopCheckoutIntent } from "./checkout-contract.js";
import { npRequireShopOrderDraft } from "./order-draft-contract.js";
import { npRequireShopOrder, npRequireShopOrderList } from "./order-contract.js";
import { npRequireShopReturn, type NpShopReturn } from "./return-contract.js";
import type {
  NpShopProductReview,
  NpShopProductReviewPage,
  NpShopProductReviewPhoto,
} from "./review-contract.js";
import {
  npRequireShopReturnLogistics,
  type NpShopReturnLogistics,
} from "./return-logistics-contract.js";
import type {
  NpShopCartClientMessages,
  NpShopCartQuote,
  NpShopCheckoutIntent,
  NpShopCurrency,
  NpShopOrder,
  NpShopOrderDraft,
  NpShopOrderList,
  NpShopProduct,
  NpShopReviewClientMessages,
} from "./types.js";

interface CartResponse {
  quote: NpShopCartQuote;
  csrfToken: string | null;
}

interface CheckoutResponse {
  intent: NpShopCheckoutIntent;
  csrfToken: string | null;
}

interface OrderDraftResponse {
  draft: NpShopOrderDraft;
  csrfToken: string | null;
}

interface OrderDraftDeleteResponse {
  deleted: true;
  csrfToken: string | null;
}

interface OrderResponse {
  order: NpShopOrder;
  csrfToken: string | null;
}

interface OrderListResponse {
  list: NpShopOrderList;
  csrfToken: string | null;
}

interface ReturnResponse {
  returnRequest: NpShopReturn;
  csrfToken: string | null;
}

interface ReturnLogisticsResponse {
  logistics: NpShopReturnLogistics;
  duplicate: boolean;
  csrfToken: string | null;
}

class ShopRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ShopRequestError";
    this.code = code;
  }
}

function formatMoney(locale: string, amountMinor: number, currency: NpShopCurrency): string {
  const fractionDigits = currency === "KRW" || currency === "JPY" ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amountMinor / (fractionDigits === 0 ? 1 : 100));
}

async function requestCart(
  apiPath: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  csrfToken?: string | null,
  body?: unknown,
): Promise<CartResponse> {
  const response = await fetch(apiPath, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as
    CartResponse | { message?: string; error?: string; actualRevision?: number };
  if (!response.ok || !("quote" in payload)) {
    const failure = payload as { message?: string; error?: string };
    throw new Error(failure.message ?? failure.error ?? "Cart request failed.");
  }
  return { ...payload, quote: npRequireShopCartQuote(payload.quote) };
}

async function requestCheckout(
  apiPath: string,
  method: "GET" | "POST" | "DELETE",
  input: {
    intentId?: string;
    csrfToken?: string | null;
    body?: unknown;
  } = {},
): Promise<CheckoutResponse> {
  const query = input.intentId ? `?id=${encodeURIComponent(input.intentId)}` : "";
  const response = await fetch(`${apiPath}${query}`, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(input.csrfToken ? { "x-csrf-token": input.csrfToken } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const payload = (await response.json()) as
    CheckoutResponse | { message?: string; error?: string };
  if (!response.ok || !("intent" in payload)) {
    const failure = payload as { message?: string; error?: string };
    throw new Error(failure.message ?? failure.error ?? "Checkout intent request failed.");
  }
  return { ...payload, intent: npRequireShopCheckoutIntent(payload.intent) };
}

async function requestOrderDraft(
  apiPath: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  input: {
    draftId?: string;
    csrfToken?: string | null;
    body?: unknown;
  } = {},
): Promise<OrderDraftResponse | OrderDraftDeleteResponse> {
  const query = input.draftId ? `?id=${encodeURIComponent(input.draftId)}` : "";
  const response = await fetch(`${apiPath}${query}`, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(input.csrfToken ? { "x-csrf-token": input.csrfToken } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const payload = (await response.json()) as
    OrderDraftResponse | OrderDraftDeleteResponse | { message?: string; error?: string };
  if (!response.ok) {
    const failure = payload as { message?: string; error?: string };
    throw new ShopRequestError(
      failure.error ?? "order_draft_request_failed",
      failure.message ?? failure.error ?? "Order draft request failed.",
    );
  }
  if ("draft" in payload) {
    return { ...payload, draft: npRequireShopOrderDraft(payload.draft) };
  }
  if ("deleted" in payload && payload.deleted === true) return payload;
  throw new Error("Order draft response was invalid.");
}

async function requestOrder(
  apiPath: string,
  method: "GET" | "POST" | "DELETE",
  input: {
    orderId?: string;
    csrfToken?: string | null;
    body?: unknown;
  } = {},
): Promise<OrderResponse | OrderListResponse> {
  const query = input.orderId ? `?id=${encodeURIComponent(input.orderId)}` : "";
  const response = await fetch(`${apiPath}${query}`, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(input.csrfToken ? { "x-csrf-token": input.csrfToken } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const payload = (await response.json()) as
    OrderResponse | OrderListResponse | { message?: string; error?: string };
  if (!response.ok) {
    const failure = payload as { message?: string; error?: string };
    throw new ShopRequestError(
      failure.error ?? "order_request_failed",
      failure.message ?? failure.error ?? "Order request failed.",
    );
  }
  if ("order" in payload) return { ...payload, order: npRequireShopOrder(payload.order) };
  if ("list" in payload) return { ...payload, list: npRequireShopOrderList(payload.list) };
  throw new Error("Order response was invalid.");
}

async function requestReturn(
  apiPath: string,
  method: "POST" | "DELETE",
  csrfToken: string | null,
  body: unknown,
): Promise<ReturnResponse> {
  const response = await fetch(apiPath, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ReturnResponse | { message?: string; error?: string };
  if (!response.ok || !("returnRequest" in payload)) {
    const failure = payload as { message?: string; error?: string };
    throw new ShopRequestError(
      failure.error ?? "return_request_failed",
      failure.message ?? failure.error ?? "Return request failed.",
    );
  }
  return { ...payload, returnRequest: npRequireShopReturn(payload.returnRequest) };
}

async function requestReturnLogistics(
  apiPath: string,
  method: "POST" | "PATCH" | "DELETE",
  csrfToken: string | null,
  body: unknown,
): Promise<ReturnLogisticsResponse> {
  const response = await fetch(apiPath, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as
    ReturnLogisticsResponse | { message?: string; error?: string };
  if (!response.ok || !("logistics" in payload)) {
    const failure = payload as { message?: string; error?: string };
    throw new ShopRequestError(
      failure.error ?? "return_logistics_failed",
      failure.message ?? failure.error ?? "Return shipping request failed.",
    );
  }
  return { ...payload, logistics: npRequireShopReturnLogistics(payload.logistics) };
}

export function ShopAddToCart({
  apiPath,
  product,
  messages,
}: {
  apiPath: string;
  product: NpShopProduct;
  messages: NpShopCartClientMessages;
}) {
  const enabledVariants = product.variants.filter((variant) => variant.enabled);
  const [variantSku, setVariantSku] = useState(enabledVariants.length === 0 ? "" : "");
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState<"idle" | "adding" | "added" | "error">("idle");
  const [error, setError] = useState("");

  async function add(): Promise<void> {
    setState("adding");
    setError("");
    try {
      const current = await requestCart(apiPath, "GET");
      await requestCart(apiPath, "POST", current.csrfToken, {
        productId: product.id,
        variantSku: variantSku || null,
        quantity,
        expectedRevision: current.quote.revision,
      });
      setState("added");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.cartUpdateFailed);
      setState("error");
    }
  }

  return (
    <div className="np-shop-add-cart" data-np-shop-cart-action>
      {enabledVariants.length > 0 ? (
        <label>
          <span>{messages.selectVariant}</span>
          <select
            value={variantSku}
            onChange={(event) => setVariantSku(event.target.value)}
            disabled={state === "adding"}
          >
            <option value="">{messages.selectVariant}</option>
            {enabledVariants.map((variant) => (
              <option key={variant.sku} value={variant.sku}>
                {variant.name} ·{" "}
                {formatMoney(
                  messages.locale,
                  variant.priceMinor ?? product.priceMinor,
                  product.currency,
                )}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <span>{messages.cartQuantity}</span>
        <input
          type="number"
          min={1}
          max={99}
          value={quantity}
          onChange={(event) => setQuantity(Math.max(1, Math.min(99, Number(event.target.value))))}
          disabled={state === "adding"}
        />
      </label>
      <button
        type="button"
        onClick={() => void add()}
        disabled={
          state === "adding" ||
          product.inventoryState === "out-of-stock" ||
          (enabledVariants.length > 0 && !variantSku)
        }
      >
        {state === "adding"
          ? messages.addingToCart
          : state === "added"
            ? messages.addedToCart
            : messages.addToCart}
      </button>
      {state === "error" ? (
        <p role="alert" className="np-shop-cart-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function issueMessage(code: string, messages: NpShopCartClientMessages): string {
  if (code === "insufficient-stock") return messages.cartInsufficientStock;
  if (code === "price-changed") return messages.cartPriceChanged;
  if (code === "mixed-currency") return messages.cartMixedCurrency;
  return messages.cartUnavailable;
}

export function ShopCart({
  apiPath,
  checkoutApiPath,
  basePath,
  initialQuote,
  messages,
}: {
  apiPath: string;
  checkoutApiPath: string;
  basePath: string;
  initialQuote: NpShopCartQuote;
  messages: NpShopCartClientMessages;
}) {
  const [quote, setQuote] = useState(initialQuote);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [error, setError] = useState("");
  const checkoutAttempt = useRef<{ snapshot: string; idempotencyKey: string } | null>(null);

  async function refresh(): Promise<void> {
    const response = await requestCart(apiPath, "GET");
    setQuote(response.quote);
    setCsrfToken(response.csrfToken);
  }

  useEffect(() => {
    void refresh()
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : messages.cartUpdateFailed);
      })
      .finally(() => setLoading(false));
  }, [apiPath]);

  async function mutate(
    method: "PUT" | "PATCH" | "DELETE",
    body: Record<string, unknown>,
  ): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const response = await requestCart(apiPath, method, csrfToken, {
        ...body,
        expectedRevision: quote.revision,
      });
      setQuote(response.quote);
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.cartUpdateFailed);
      await refresh().catch(() => undefined);
    } finally {
      setLoading(false);
    }
  }

  async function beginCheckout(): Promise<void> {
    setLoading(true);
    setCreatingCheckout(true);
    setError("");
    try {
      const snapshot = `${quote.revision.toString()}:${quote.fingerprint}`;
      if (checkoutAttempt.current?.snapshot !== snapshot) {
        checkoutAttempt.current = { snapshot, idempotencyKey: crypto.randomUUID() };
      }
      const response = await requestCheckout(checkoutApiPath, "POST", {
        csrfToken,
        body: {
          idempotencyKey: checkoutAttempt.current.idempotencyKey,
          expectedRevision: quote.revision,
          expectedFingerprint: quote.fingerprint,
        },
      });
      window.location.assign(`${basePath}/checkout/${response.intent.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.checkoutFailed);
      await refresh().catch(() => undefined);
      setLoading(false);
      setCreatingCheckout(false);
    }
  }

  return (
    <div className="np-shop-cart-client" aria-busy={loading}>
      {error ? (
        <p role="alert" className="np-shop-cart-error">
          {error}
        </p>
      ) : null}
      {quote.lines.length === 0 ? (
        <div className="np-shop-cart-empty">
          <p>{messages.cartEmpty}</p>
          <a href={basePath}>{messages.cart}</a>
          <a href={`${basePath}/orders`}>{messages.orderHistory}</a>
        </div>
      ) : (
        <>
          <ul className="np-shop-cart-lines">
            {quote.lines.map((line) => (
              <li key={line.key} data-np-shop-cart-line={line.key}>
                {line.imageUrl ? <img src={line.imageUrl} alt="" /> : null}
                <div>
                  <a
                    href={line.productSlug ? `${basePath}/products/${line.productSlug}` : basePath}
                  >
                    <strong>{line.productName}</strong>
                  </a>
                  {line.variantName ? <span>{line.variantName}</span> : null}
                  {line.issues.map((issue) => (
                    <small key={issue}>{issueMessage(issue, messages)}</small>
                  ))}
                </div>
                <label>
                  <span>{messages.cartQuantity}</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={line.quantity}
                    disabled={loading}
                    onChange={(event) =>
                      void mutate("PATCH", {
                        lineKey: line.key,
                        quantity: Math.max(1, Math.min(99, Number(event.target.value))),
                      })
                    }
                  />
                </label>
                <strong>{formatMoney(messages.locale, line.lineTotalMinor, line.currency)}</strong>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void mutate("DELETE", { lineKey: line.key })}
                >
                  {messages.cartRemove}
                </button>
              </li>
            ))}
          </ul>
          <aside className="np-shop-cart-summary">
            <form
              className="np-shop-coupon-form"
              onSubmit={(event) => {
                event.preventDefault();
                const next = couponCode.trim();
                if (!next) return;
                void mutate("PUT", {
                  couponCodes: [...quote.promotions.couponCodes, next],
                }).then(() => setCouponCode(""));
              }}
            >
              <label>
                <span>{messages.couponCode}</span>
                <input
                  value={couponCode}
                  maxLength={32}
                  placeholder={messages.couponPlaceholder}
                  disabled={loading || quote.promotions.couponCodes.length >= 5}
                  onChange={(event) => setCouponCode(event.target.value)}
                />
              </label>
              <button type="submit" disabled={loading || !couponCode.trim()}>
                {messages.couponApply}
              </button>
            </form>
            {quote.promotions.couponCodes.length > 0 ? (
              <ul className="np-shop-coupons">
                {quote.promotions.couponCodes.map((code) => (
                  <li key={code}>
                    <span>{code}</span>
                    {quote.promotions.rejectedCouponCodes.includes(code) ? (
                      <small>{messages.couponRejected}</small>
                    ) : null}
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        void mutate("PUT", {
                          couponCodes: quote.promotions.couponCodes.filter(
                            (candidate) => candidate !== code,
                          ),
                        })
                      }
                    >
                      {messages.couponRemove}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {quote.promotions.applied.length > 0 ? (
              <ul className="np-shop-promotions">
                {quote.promotions.applied.map((promotion) => (
                  <li key={promotion.id}>
                    <span>{promotion.name}</span>
                    <strong>
                      −
                      {formatMoney(
                        messages.locale,
                        promotion.discountMinor,
                        quote.totals[0].currency,
                      )}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : null}
            <h2>{messages.cartSubtotal}</h2>
            {quote.totals.map((total) => (
              <div key={total.currency} className="np-shop-cart-totals">
                <span>{formatMoney(messages.locale, total.subtotalMinor, total.currency)}</span>
                {total.discountMinor > 0 ? (
                  <span>
                    {messages.promotionDiscount}: −
                    {formatMoney(messages.locale, total.discountMinor, total.currency)}
                  </span>
                ) : null}
                <strong>{formatMoney(messages.locale, total.totalMinor, total.currency)}</strong>
              </div>
            ))}
            <p className={quote.ready ? "np-shop-cart-ready" : "np-shop-cart-not-ready"}>
              {quote.ready ? messages.cartReady : messages.cartNotReady}
            </p>
            <p>{messages.cartCheckoutUnavailable}</p>
            <button
              type="button"
              disabled={loading || creatingCheckout || !quote.ready}
              onClick={() => void beginCheckout()}
            >
              {creatingCheckout ? messages.checkoutCreating : messages.checkout}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void mutate("DELETE", { lineKey: null })}
            >
              {messages.cartClear}
            </button>
            <a href={`${basePath}/orders`}>{messages.orderHistory}</a>
          </aside>
        </>
      )}
    </div>
  );
}

function checkoutStatusMessage(
  intent: NpShopCheckoutIntent,
  messages: NpShopCartClientMessages,
): string {
  if (intent.status === "open") return messages.checkoutOpen;
  if (intent.status === "stale") return messages.checkoutStale;
  if (intent.status === "cancelled") return messages.checkoutCancelled;
  return messages.checkoutExpired;
}

export function ShopCheckout({
  apiPath,
  orderDraftApiPath,
  basePath,
  intentId,
  messages,
}: {
  apiPath: string;
  orderDraftApiPath: string;
  basePath: string;
  intentId: string;
  messages: NpShopCartClientMessages;
}) {
  const [intent, setIntent] = useState<NpShopCheckoutIntent | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [error, setError] = useState("");
  const draftAttempt = useRef<{ intentId: string; idempotencyKey: string } | null>(null);

  useEffect(() => {
    void requestCheckout(apiPath, "GET", { intentId })
      .then((response) => {
        setIntent(response.intent);
        setCsrfToken(response.csrfToken);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : messages.checkoutFailed);
      })
      .finally(() => setLoading(false));
  }, [apiPath, intentId]);

  async function cancel(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const response = await requestCheckout(apiPath, "DELETE", {
        csrfToken,
        body: { intentId },
      });
      setIntent(response.intent);
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.checkoutFailed);
    } finally {
      setLoading(false);
    }
  }

  async function createDraft(): Promise<void> {
    if (!intent || intent.status !== "open") return;
    setLoading(true);
    setCreatingDraft(true);
    setError("");
    try {
      if (draftAttempt.current?.intentId !== intent.id) {
        draftAttempt.current = { intentId: intent.id, idempotencyKey: crypto.randomUUID() };
      }
      const response = await requestOrderDraft(orderDraftApiPath, "POST", {
        csrfToken,
        body: {
          idempotencyKey: draftAttempt.current.idempotencyKey,
          checkoutIntentId: intent.id,
        },
      });
      if (!("draft" in response)) throw new Error(messages.orderDraftFailed);
      window.location.assign(`${basePath}/order-drafts/${response.draft.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.orderDraftFailed);
      setLoading(false);
      setCreatingDraft(false);
    }
  }

  return (
    <div className="np-shop-checkout-client" aria-busy={loading}>
      {error ? (
        <p role="alert" className="np-shop-cart-error">
          {error}
        </p>
      ) : null}
      {intent ? (
        <>
          <section className="np-shop-checkout-intent">
            <header>
              <strong>{messages.checkoutIntent}</strong>
              <span data-np-shop-checkout-status={intent.status}>
                {checkoutStatusMessage(intent, messages)}
              </span>
            </header>
            <ul>
              {intent.lines.map((line) => (
                <li key={line.key} data-np-shop-checkout-line={line.key}>
                  <div>
                    <a href={`${basePath}/products/${line.productSlug}`}>
                      <strong>{line.productName}</strong>
                    </a>
                    {line.variantName ? <span>{line.variantName}</span> : null}
                  </div>
                  <span>
                    {messages.cartQuantity} {line.quantity.toLocaleString(messages.locale)}
                  </span>
                  <strong>
                    {formatMoney(messages.locale, line.lineTotalMinor, intent.currency)}
                  </strong>
                </li>
              ))}
            </ul>
          </section>
          <aside className="np-shop-checkout-summary">
            <span>{messages.cartSubtotal}</span>
            <strong>{formatMoney(messages.locale, intent.subtotalMinor, intent.currency)}</strong>
            {intent.promotions.applied.map((promotion) => (
              <span key={promotion.id}>
                {promotion.name}: −
                {formatMoney(messages.locale, promotion.discountMinor, intent.currency)}
              </span>
            ))}
            {intent.discountMinor > 0 ? (
              <strong>{formatMoney(messages.locale, intent.totalMinor, intent.currency)}</strong>
            ) : null}
            <p>
              {messages.checkoutExpires}{" "}
              {new Intl.DateTimeFormat(messages.locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(intent.expiresAt))}
            </p>
            <p>{messages.checkoutPaymentUnavailable}</p>
            {intent.status === "open" ? (
              <button type="button" disabled={loading} onClick={() => void createDraft()}>
                {creatingDraft ? messages.orderDraftCreating : messages.orderDraftCreate}
              </button>
            ) : null}
            {intent.status === "open" || intent.status === "stale" ? (
              <button type="button" disabled={loading} onClick={() => void cancel()}>
                {messages.checkoutCancel}
              </button>
            ) : null}
            <a href={`${basePath}/cart`}>{messages.checkoutBackToCart}</a>
          </aside>
        </>
      ) : loading ? (
        <p>{messages.checkoutCreating}</p>
      ) : null}
    </div>
  );
}

function orderDraftStatusMessage(
  draft: NpShopOrderDraft,
  messages: NpShopCartClientMessages,
): string {
  if (draft.status === "collecting") return messages.orderDraftCollecting;
  if (draft.status === "shipping-selection-required") {
    return messages.orderDraftShippingRequired;
  }
  if (draft.status === "reviewable") return messages.orderDraftReviewable;
  return messages.orderDraftStale;
}

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function ShopOrderDraft({
  apiPath,
  orderApiPath,
  basePath,
  draftId,
  messages,
}: {
  apiPath: string;
  orderApiPath: string;
  basePath: string;
  draftId: string;
  messages: NpShopCartClientMessages;
}) {
  const [draft, setDraft] = useState<NpShopOrderDraft | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const orderAttempt = useRef<{ draftId: string; idempotencyKey: string } | null>(null);

  useEffect(() => {
    void requestOrderDraft(apiPath, "GET", { draftId })
      .then((response) => {
        if (!("draft" in response)) throw new Error(messages.orderDraftFailed);
        setDraft(response.draft);
        setCsrfToken(response.csrfToken);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : messages.orderDraftFailed);
      })
      .finally(() => setLoading(false));
  }, [apiPath, draftId]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft || draft.status === "stale") return;
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await requestOrderDraft(apiPath, "PATCH", {
        csrfToken,
        body: {
          draftId,
          expectedRevision: draft.revision,
          customer: {
            fullName: formString(form, "customerFullName"),
            email: formString(form, "customerEmail"),
            phone: formString(form, "customerPhone"),
          },
          shipping: {
            recipientName: formString(form, "recipientName"),
            phone: formString(form, "shippingPhone"),
            countryCode: formString(form, "countryCode"),
            postalCode: formString(form, "postalCode"),
            addressLine1: formString(form, "addressLine1"),
            addressLine2: formString(form, "addressLine2") || null,
            locality: formString(form, "locality"),
            administrativeArea: formString(form, "administrativeArea") || null,
          },
        },
      });
      if (!("draft" in response)) throw new Error(messages.orderDraftFailed);
      setDraft(response.draft);
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      if (caught instanceof ShopRequestError) {
        if (caught.code === "order_draft_expired" || caught.code === "order_draft_not_found") {
          setDraft(null);
        } else if (
          caught.code === "order_draft_revision_conflict" ||
          caught.code === "order_draft_source_stale"
        ) {
          try {
            const refreshed = await requestOrderDraft(apiPath, "GET", { draftId });
            if ("draft" in refreshed) {
              setDraft(refreshed.draft);
              setCsrfToken(refreshed.csrfToken);
            }
          } catch (refreshError) {
            if (
              refreshError instanceof ShopRequestError &&
              (refreshError.code === "order_draft_expired" ||
                refreshError.code === "order_draft_not_found")
            ) {
              setDraft(null);
            }
          }
        }
      }
      setError(caught instanceof Error ? caught.message : messages.orderDraftFailed);
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      await requestOrderDraft(apiPath, "DELETE", {
        csrfToken,
        body: { draftId },
      });
      setDraft(null);
      window.location.assign(`${basePath}/cart`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.orderDraftFailed);
      setSaving(false);
    }
  }

  async function createOrder(): Promise<void> {
    if (!draft || draft.status !== "reviewable") return;
    setSaving(true);
    setError("");
    try {
      if (orderAttempt.current?.draftId !== draft.id) {
        orderAttempt.current = { draftId: draft.id, idempotencyKey: crypto.randomUUID() };
      }
      const response = await requestOrder(orderApiPath, "POST", {
        csrfToken,
        body: {
          idempotencyKey: orderAttempt.current.idempotencyKey,
          draftId: draft.id,
          expectedRevision: draft.revision,
        },
      });
      if (!("order" in response)) throw new Error(messages.orderFailed);
      window.location.assign(`${basePath}/orders/${response.order.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.orderFailed);
      setSaving(false);
    }
  }

  async function selectShippingMethod(methodId: string): Promise<void> {
    if (!draft || draft.status !== "shipping-selection-required") return;
    setSaving(true);
    setError("");
    try {
      const response = await requestOrderDraft(apiPath, "PUT", {
        csrfToken,
        body: { draftId: draft.id, expectedRevision: draft.revision, methodId },
      });
      if (!("draft" in response)) throw new Error(messages.orderDraftFailed);
      setDraft(response.draft);
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.orderDraftFailed);
    } finally {
      setSaving(false);
    }
  }

  const disabled = saving || draft?.status === "stale";
  return (
    <div className="np-shop-order-draft-client" aria-busy={loading || saving}>
      {error ? (
        <p role="alert" className="np-shop-cart-error">
          {error}
        </p>
      ) : null}
      {draft ? (
        <>
          <header className="np-shop-order-draft-header">
            <div>
              <p>{messages.orderDraft}</p>
              <h1>{messages.orderDraftCustomer}</h1>
            </div>
            <span data-np-shop-order-draft-status={draft.status}>
              {orderDraftStatusMessage(draft, messages)}
            </span>
          </header>
          <div className="np-shop-order-draft-layout">
            <form key={draft.revision} onSubmit={(event) => void save(event)}>
              <fieldset disabled={disabled}>
                <legend>{messages.orderDraftCustomer}</legend>
                <label className="np-shop-order-draft-wide">
                  <span>{messages.orderDraftFullName}</span>
                  <input
                    name="customerFullName"
                    required
                    maxLength={120}
                    autoComplete="name"
                    defaultValue={draft.customer?.fullName ?? ""}
                  />
                </label>
                <label>
                  <span>{messages.orderDraftEmail}</span>
                  <input
                    name="customerEmail"
                    required
                    type="email"
                    maxLength={254}
                    autoComplete="email"
                    defaultValue={draft.customer?.email ?? ""}
                  />
                </label>
                <label>
                  <span>{messages.orderDraftPhone}</span>
                  <input
                    name="customerPhone"
                    required
                    type="tel"
                    maxLength={32}
                    autoComplete="tel"
                    defaultValue={draft.customer?.phone ?? ""}
                  />
                </label>
              </fieldset>
              <fieldset disabled={disabled}>
                <legend>{messages.orderDraftShipping}</legend>
                <label>
                  <span>{messages.orderDraftRecipientName}</span>
                  <input
                    name="recipientName"
                    required
                    maxLength={120}
                    autoComplete="shipping name"
                    defaultValue={draft.shipping?.recipientName ?? ""}
                  />
                </label>
                <label>
                  <span>{messages.orderDraftPhone}</span>
                  <input
                    name="shippingPhone"
                    required
                    type="tel"
                    maxLength={32}
                    autoComplete="shipping tel"
                    defaultValue={draft.shipping?.phone ?? ""}
                  />
                </label>
                <div className="np-shop-order-draft-row">
                  <label>
                    <span>{messages.orderDraftCountryCode}</span>
                    <input
                      name="countryCode"
                      required
                      minLength={2}
                      maxLength={2}
                      autoComplete="shipping country"
                      defaultValue={draft.shipping?.countryCode ?? ""}
                    />
                  </label>
                  <label>
                    <span>{messages.orderDraftPostalCode}</span>
                    <input
                      name="postalCode"
                      required
                      maxLength={20}
                      autoComplete="shipping postal-code"
                      defaultValue={draft.shipping?.postalCode ?? ""}
                    />
                  </label>
                </div>
                <label className="np-shop-order-draft-wide">
                  <span>{messages.orderDraftAddressLine1}</span>
                  <input
                    name="addressLine1"
                    required
                    maxLength={200}
                    autoComplete="shipping address-line1"
                    defaultValue={draft.shipping?.addressLine1 ?? ""}
                  />
                </label>
                <label className="np-shop-order-draft-wide">
                  <span>{messages.orderDraftAddressLine2}</span>
                  <input
                    name="addressLine2"
                    maxLength={200}
                    autoComplete="shipping address-line2"
                    defaultValue={draft.shipping?.addressLine2 ?? ""}
                  />
                </label>
                <div className="np-shop-order-draft-row">
                  <label>
                    <span>{messages.orderDraftLocality}</span>
                    <input
                      name="locality"
                      required
                      maxLength={100}
                      autoComplete="shipping address-level2"
                      defaultValue={draft.shipping?.locality ?? ""}
                    />
                  </label>
                  <label>
                    <span>{messages.orderDraftAdministrativeArea}</span>
                    <input
                      name="administrativeArea"
                      maxLength={100}
                      autoComplete="shipping address-level1"
                      defaultValue={draft.shipping?.administrativeArea ?? ""}
                    />
                  </label>
                </div>
              </fieldset>
              <p className="np-shop-order-draft-privacy">{messages.orderDraftPrivacy}</p>
              <button type="submit" disabled={disabled}>
                {saving ? messages.orderDraftSaving : messages.orderDraftSave}
              </button>
            </form>
            <aside className="np-shop-order-draft-summary">
              <h2>{messages.checkoutIntent}</h2>
              <ul>
                {draft.lines.map((line) => (
                  <li key={line.key} data-np-shop-order-draft-line={line.key}>
                    <span>
                      {line.productName} × {line.quantity.toLocaleString(messages.locale)}
                    </span>
                    <strong>
                      {formatMoney(messages.locale, line.lineTotalMinor, draft.currency)}
                    </strong>
                  </li>
                ))}
              </ul>
              <div>
                <span>{messages.cartSubtotal}</span>
                <strong>{formatMoney(messages.locale, draft.subtotalMinor, draft.currency)}</strong>
              </div>
              {draft.promotions.applied.map((promotion) => (
                <div key={promotion.id}>
                  <span>{promotion.name}</span>
                  <strong>
                    −{formatMoney(messages.locale, promotion.discountMinor, draft.currency)}
                  </strong>
                </div>
              ))}
              {draft.shippingQuote ? (
                <section className="np-shop-shipping-methods">
                  <h3>{messages.orderDraftShippingMethods}</h3>
                  <ul>
                    {draft.shippingQuote.methods.map((method) => (
                      <li key={method.id}>
                        <span>{method.label}</span>
                        <strong>
                          {formatMoney(messages.locale, method.amountMinor, draft.currency)}
                        </strong>
                        {method.estimatedDelivery ? (
                          <small>
                            {method.estimatedDelivery.minimumDays.toLocaleString(messages.locale)}–
                            {method.estimatedDelivery.maximumDays.toLocaleString(messages.locale)}{" "}
                            {messages.orderDraftShippingDays}
                          </small>
                        ) : null}
                        {draft.status === "shipping-selection-required" ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void selectShippingMethod(method.id)}
                          >
                            {saving
                              ? messages.orderDraftShippingSelecting
                              : messages.orderDraftShippingSelect}
                          </button>
                        ) : draft.deliveryMethod?.methodId === method.id ? (
                          <span aria-current="true">{messages.orderDraftReviewable}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : draft.status === "shipping-selection-required" ? (
                <p>{messages.orderDraftShippingUnavailable}</p>
              ) : null}
              <div>
                <span>{messages.shippingAmount}</span>
                <strong>{formatMoney(messages.locale, draft.shippingMinor, draft.currency)}</strong>
              </div>
              {draft.taxQuote && draft.taxQuote.components.length > 0 ? (
                <section className="np-shop-tax-components">
                  <h3>{messages.taxBreakdown}</h3>
                  <ul>
                    {draft.taxQuote.components.map((component) => (
                      <li key={component.id}>
                        <span>{component.label}</span>
                        <strong>
                          {formatMoney(messages.locale, component.amountMinor, draft.currency)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <div>
                <span>{messages.taxAmount}</span>
                <strong>{formatMoney(messages.locale, draft.taxMinor, draft.currency)}</strong>
              </div>
              <div>
                <span>{messages.orderTotal}</span>
                <strong>{formatMoney(messages.locale, draft.totalMinor, draft.currency)}</strong>
              </div>
              <p>
                {messages.orderDraftExpires}{" "}
                {new Intl.DateTimeFormat(messages.locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(draft.expiresAt))}
              </p>
              <p>{messages.orderDraftPaymentUnavailable}</p>
              {draft.status === "reviewable" ? (
                <button type="button" disabled={saving} onClick={() => void createOrder()}>
                  {saving ? messages.orderCreating : messages.orderCreate}
                </button>
              ) : null}
              <button type="button" disabled={saving} onClick={() => void remove()}>
                {messages.orderDraftDelete}
              </button>
              <a href={`${basePath}/cart`}>{messages.checkoutBackToCart}</a>
            </aside>
          </div>
        </>
      ) : loading ? (
        <p>{messages.orderDraftCreating}</p>
      ) : (
        <a href={`${basePath}/cart`}>{messages.checkoutBackToCart}</a>
      )}
    </div>
  );
}

function orderStatusMessage(order: NpShopOrder, messages: NpShopCartClientMessages): string {
  switch (order.status) {
    case "pending-payment":
      return messages.orderPendingPayment;
    case "paid":
      return messages.orderPaid;
    case "refunded":
      return messages.orderRefunded;
    case "payment-failed":
      return messages.orderPaymentFailed;
    case "cancelled":
      return messages.orderCancelled;
  }
}

function fulfillmentStatusMessage(
  order: NpShopOrder,
  messages: NpShopCartClientMessages,
): string | null {
  if (!order.fulfillment) return null;
  switch (order.fulfillment.status) {
    case "awaiting":
      return messages.orderFulfillmentAwaiting;
    case "processing":
      return messages.orderFulfillmentProcessing;
    case "shipped":
      return messages.orderFulfillmentShipped;
    case "cancelled":
      return messages.orderFulfillmentCancelled;
  }
}

function trackingStatusMessage(
  order: NpShopOrder,
  messages: NpShopCartClientMessages,
): string | null {
  switch (order.tracking?.status) {
    case "in-transit":
      return messages.orderTrackingInTransit;
    case "out-for-delivery":
      return messages.orderTrackingOutForDelivery;
    case "delivered":
      return messages.orderTrackingDelivered;
    case "exception":
      return messages.orderTrackingException;
    default:
      return null;
  }
}

export function ShopOrders({
  apiPath,
  basePath,
  messages,
}: {
  apiPath: string;
  basePath: string;
  messages: NpShopCartClientMessages;
}) {
  const [list, setList] = useState<NpShopOrderList | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void requestOrder(apiPath, "GET")
      .then((response) => {
        if (!("list" in response)) throw new Error(messages.orderFailed);
        setList(response.list);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : messages.orderFailed);
      });
  }, [apiPath]);

  if (error) {
    return (
      <p role="alert" className="np-shop-cart-error">
        {error}
      </p>
    );
  }
  if (!list) return <p>{messages.orderCreating}</p>;
  if (list.orders.length === 0) return <p>{messages.orderEmpty}</p>;
  return (
    <div className="np-shop-order-list">
      {list.orders.map((order) => (
        <article key={order.id} data-np-shop-order-status={order.status}>
          <div>
            <span>{messages.orderReference}</span>
            <code>{order.id}</code>
          </div>
          <strong>{orderStatusMessage(order, messages)}</strong>
          {fulfillmentStatusMessage(order, messages) ? (
            <span data-np-shop-fulfillment-status={order.fulfillment?.status}>
              {fulfillmentStatusMessage(order, messages)}
            </span>
          ) : null}
          <span>{formatMoney(messages.locale, order.totalMinor, order.currency)}</span>
          <time dateTime={order.createdAt}>
            {new Intl.DateTimeFormat(messages.locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(order.createdAt))}
          </time>
          <a href={`${basePath}/orders/${order.id}`}>{messages.order}</a>
        </article>
      ))}
    </div>
  );
}

export function ShopOrder({
  apiPath,
  returnApiPath,
  returnLogisticsApiPath,
  returnLogisticsLabelPath,
  basePath,
  orderId,
  paymentAction,
  messages,
}: {
  apiPath: string;
  returnApiPath: string;
  returnLogisticsApiPath?: string;
  returnLogisticsLabelPath?: string;
  basePath: string;
  orderId: string;
  paymentAction?: ReactNode;
  messages: NpShopCartClientMessages;
}) {
  const [order, setOrder] = useState<NpShopOrder | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [returnLogisticsMode, setReturnLogisticsMode] =
    useState<NpShopReturnLogistics["mode"]>("dropoff");

  useEffect(() => {
    void requestOrder(apiPath, "GET", { orderId })
      .then((response) => {
        if (!("order" in response)) throw new Error(messages.orderFailed);
        setOrder(response.order);
        setCsrfToken(response.csrfToken);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : messages.orderFailed);
      })
      .finally(() => setBusy(false));
  }, [apiPath, orderId]);

  async function refreshOrderState(): Promise<void> {
    try {
      const response = await requestOrder(apiPath, "GET", { orderId });
      if (!("order" in response)) return;
      setOrder(response.order);
      setCsrfToken(response.csrfToken);
    } catch {
      // Preserve the mutation error; a normal reload can recover read state.
    }
  }

  async function cancel(): Promise<void> {
    if (!order || order.status !== "pending-payment") return;
    setBusy(true);
    setError("");
    try {
      const response = await requestOrder(apiPath, "DELETE", {
        csrfToken,
        body: { orderId: order.id, expectedRevision: order.revision },
      });
      if (!("order" in response)) throw new Error(messages.orderFailed);
      setOrder(response.order);
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.orderFailed);
    } finally {
      setBusy(false);
    }
  }

  async function requestPhysicalReturn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!order || order.fulfillment?.status !== "shipped" || order.returnRequest) return;
    const form = new FormData(event.currentTarget);
    const detailValue = form.get("detail");
    const lines = order.lines.flatMap((line) => {
      const raw = form.get(`line:${line.key}`);
      const quantity = typeof raw === "string" ? Number(raw) : 0;
      return Number.isSafeInteger(quantity) && quantity > 0
        ? [{ lineKey: line.key, quantity }]
        : [];
    });
    if (lines.length === 0) {
      setError(messages.orderReturnSelectItem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await requestReturn(returnApiPath, "POST", csrfToken, {
        orderId: order.id,
        expectedOrderRevision: order.revision,
        lines,
        reason: form.get("reason"),
        detail: typeof detailValue === "string" && detailValue.trim() ? detailValue.trim() : null,
      });
      setOrder({ ...order, returnRequest: response.returnRequest });
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.orderReturnFailed);
    } finally {
      setBusy(false);
    }
  }

  async function cancelPhysicalReturn(): Promise<void> {
    if (!order?.returnRequest || order.returnRequest.status !== "requested") return;
    setBusy(true);
    setError("");
    try {
      const response = await requestReturn(returnApiPath, "DELETE", csrfToken, {
        orderId: order.id,
        expectedRevision: order.returnRequest.revision,
      });
      setOrder({ ...order, returnRequest: response.returnRequest });
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.orderReturnFailed);
    } finally {
      setBusy(false);
    }
  }

  async function createReturnShipping(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      !order?.returnRequest ||
      order.returnRequest.status !== "approved" ||
      order.returnRequest.logistics ||
      !returnLogisticsApiPath
    ) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const text = (name: string): string => {
      const value = form.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const nullable = (name: string): string | null => text(name) || null;
    const mode = text("mode");
    const readyValue = text("readyAt");
    const closeValue = text("closeAt");
    setBusy(true);
    setError("");
    try {
      const response = await requestReturnLogistics(returnLogisticsApiPath, "POST", csrfToken, {
        orderId: order.id,
        returnId: order.returnRequest.id,
        expectedReturnRevision: order.returnRequest.revision,
        mode,
        origin: {
          recipientName: text("recipientName"),
          phone: text("phone"),
          countryCode: text("countryCode").toUpperCase(),
          postalCode: text("postalCode"),
          addressLine1: text("addressLine1"),
          addressLine2: nullable("addressLine2"),
          locality: text("locality"),
          administrativeArea: nullable("administrativeArea"),
        },
        readyAt: mode === "pickup" && readyValue ? new Date(readyValue).toISOString() : null,
        closeAt: mode === "pickup" && closeValue ? new Date(closeValue).toISOString() : null,
      });
      setOrder({
        ...order,
        returnRequest: { ...order.returnRequest, logistics: response.logistics },
      });
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      await refreshOrderState();
      setError(caught instanceof Error ? caught.message : messages.orderReturnLogisticsFailed);
    } finally {
      setBusy(false);
    }
  }

  async function cancelReturnShipping(): Promise<void> {
    const logistics = order?.returnRequest?.logistics;
    if (!order?.returnRequest || !logistics || !returnLogisticsApiPath) return;
    setBusy(true);
    setError("");
    try {
      const response = await requestReturnLogistics(returnLogisticsApiPath, "DELETE", csrfToken, {
        orderId: order.id,
        returnId: order.returnRequest.id,
        logisticsId: logistics.id,
        expectedRevision: logistics.revision,
      });
      setOrder({
        ...order,
        returnRequest: { ...order.returnRequest, logistics: response.logistics },
      });
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      await refreshOrderState();
      setError(caught instanceof Error ? caught.message : messages.orderReturnLogisticsFailed);
    } finally {
      setBusy(false);
    }
  }

  async function resumeReturnShipping(): Promise<void> {
    const logistics = order?.returnRequest?.logistics;
    if (!order?.returnRequest || !logistics || !returnLogisticsApiPath) return;
    setBusy(true);
    setError("");
    try {
      const response = await requestReturnLogistics(returnLogisticsApiPath, "PATCH", csrfToken, {
        orderId: order.id,
        returnId: order.returnRequest.id,
        logisticsId: logistics.id,
        expectedRevision: logistics.revision,
      });
      setOrder({
        ...order,
        returnRequest: { ...order.returnRequest, logistics: response.logistics },
      });
      setCsrfToken(response.csrfToken);
    } catch (caught) {
      await refreshOrderState();
      setError(caught instanceof Error ? caught.message : messages.orderReturnLogisticsFailed);
    } finally {
      setBusy(false);
    }
  }

  function returnStatusMessage(returnRequest: NpShopReturn): string {
    return {
      requested: messages.orderReturnRequested,
      approved: messages.orderReturnApproved,
      rejected: messages.orderReturnRejected,
      received: messages.orderReturnReceived,
      cancelled: messages.orderReturnCancelled,
    }[returnRequest.status];
  }

  function returnReasonMessage(reason: NpShopReturn["reason"]): string {
    return {
      damaged: messages.orderReturnReasonDamaged,
      defective: messages.orderReturnReasonDefective,
      "wrong-item": messages.orderReturnReasonWrongItem,
      "changed-mind": messages.orderReturnReasonChangedMind,
      other: messages.orderReturnReasonOther,
    }[reason];
  }

  function returnLogisticsStatusMessage(logistics: NpShopReturnLogistics): string {
    if (logistics.status === "active") return messages.orderReturnLogisticsActive;
    if (logistics.status === "cancelled") return messages.orderReturnLogisticsCancelled;
    return messages.orderReturnLogisticsPending;
  }

  function returnTrackingStatusMessage(logistics: NpShopReturnLogistics): string | null {
    switch (logistics.tracking?.status) {
      case "in-transit":
        return messages.orderReturnTrackingInTransit;
      case "out-for-delivery":
        return messages.orderReturnTrackingOutForDelivery;
      case "delivered":
        return messages.orderReturnTrackingDelivered;
      case "exception":
        return messages.orderReturnTrackingException;
      default:
        return null;
    }
  }

  return (
    <div className="np-shop-order-client" aria-busy={busy}>
      {error ? (
        <p role="alert" className="np-shop-cart-error">
          {error}
        </p>
      ) : null}
      {order ? (
        <>
          <header className="np-shop-order-header">
            <div>
              <p>{messages.orderReference}</p>
              <h1>{order.id}</h1>
            </div>
            <span data-np-shop-order-status={order.status}>
              {orderStatusMessage(order, messages)}
            </span>
          </header>
          <div className="np-shop-order-layout">
            <section>
              <h2>{messages.order}</h2>
              <ul>
                {order.lines.map((line) => (
                  <li key={line.key} data-np-shop-order-line={line.key}>
                    <span>
                      {line.productName} × {line.quantity.toLocaleString(messages.locale)}
                    </span>
                    <strong>
                      {formatMoney(messages.locale, line.lineTotalMinor, order.currency)}
                    </strong>
                  </li>
                ))}
              </ul>
              <div>
                <span>{messages.cartSubtotal}</span>
                <strong>{formatMoney(messages.locale, order.subtotalMinor, order.currency)}</strong>
              </div>
              {order.promotions.applied.map((promotion) => (
                <div key={promotion.id}>
                  <span>{promotion.name}</span>
                  <strong>
                    −{formatMoney(messages.locale, promotion.discountMinor, order.currency)}
                  </strong>
                </div>
              ))}
              <div>
                <span>{messages.shippingAmount}</span>
                <strong>{formatMoney(messages.locale, order.shippingMinor, order.currency)}</strong>
              </div>
              {order.taxQuote && order.taxQuote.components.length > 0 ? (
                <section className="np-shop-tax-components">
                  <h3>{messages.taxBreakdown}</h3>
                  <ul>
                    {order.taxQuote.components.map((component) => (
                      <li key={component.id}>
                        <span>{component.label}</span>
                        <strong>
                          {formatMoney(messages.locale, component.amountMinor, order.currency)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <div>
                <span>{messages.taxAmount}</span>
                <strong>{formatMoney(messages.locale, order.taxMinor, order.currency)}</strong>
              </div>
              <div>
                <span>{messages.orderTotal}</span>
                <strong>{formatMoney(messages.locale, order.totalMinor, order.currency)}</strong>
              </div>
            </section>
            <aside>
              <p>
                {order.status === "paid"
                  ? order.partialRefund
                    ? messages.orderPartialRefundedDetail
                    : messages.orderPaymentVerified
                  : order.status === "refunded"
                    ? messages.orderRefundedDetail
                    : order.status === "payment-failed"
                      ? messages.orderPaymentFailedDetail
                      : messages.orderPaymentUnavailable}
              </p>
              {order.partialRefund ? (
                <div data-np-shop-partial-refund={order.partialRefund.status}>
                  <p>
                    {messages.orderReturn}: {order.partialRefund.status}
                  </p>
                  <p>
                    {messages.cartSubtotal}:{" "}
                    {formatMoney(
                      messages.locale,
                      order.partialRefund.allocation.itemAmountMinor,
                      order.currency,
                    )}
                    {" · "}
                    {messages.shippingAmount}:{" "}
                    {formatMoney(
                      messages.locale,
                      order.partialRefund.allocation.shippingMinor,
                      order.currency,
                    )}
                    {" · "}
                    {messages.taxAmount}:{" "}
                    {formatMoney(
                      messages.locale,
                      order.partialRefund.allocation.taxMinor,
                      order.currency,
                    )}
                  </p>
                  <strong>
                    {formatMoney(messages.locale, order.partialRefund.amountMinor, order.currency)}
                  </strong>
                </div>
              ) : null}
              {order.fulfillment ? (
                <div data-np-shop-fulfillment-status={order.fulfillment.status}>
                  <p>{fulfillmentStatusMessage(order, messages)}</p>
                  {order.fulfillment.status === "shipped" &&
                  order.fulfillment.carrier &&
                  order.fulfillment.trackingNumber ? (
                    <p>
                      {messages.orderFulfillmentTracking}: {order.fulfillment.carrier}{" "}
                      {order.fulfillment.trackingNumber}
                    </p>
                  ) : null}
                  {order.tracking ? (
                    <p data-np-shop-tracking-status={order.tracking.status}>
                      {trackingStatusMessage(order, messages)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p>
                {order.privateDataStatus === "retained"
                  ? messages.orderPrivateRetained
                  : messages.orderPrivateRedacted}
              </p>
              <p>
                {order.refund?.inventoryOutcome === "restocked"
                  ? messages.orderRefundInventoryRestocked
                  : order.refund?.inventoryOutcome === "manual-required"
                    ? messages.orderRefundInventoryManual
                    : order.refund?.inventoryOutcome === "not-applicable-shipped"
                      ? messages.orderRefundInventoryShipped
                      : order.inventoryReservationStatus === "held"
                        ? messages.orderInventoryHeld
                        : order.inventoryReservationStatus === "consumed"
                          ? messages.orderInventoryConsumed
                          : order.inventoryReservationStatus === "released"
                            ? messages.orderInventoryReleased
                            : messages.orderInventoryNotRequired}
              </p>
              <p>
                {messages.orderCreated}{" "}
                {new Intl.DateTimeFormat(messages.locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(order.createdAt))}
              </p>
              {order.status === "pending-payment" ? (
                <>
                  {paymentAction ? (
                    <div className="np-shop-payment-action" data-np-shop-payment-action>
                      {paymentAction}
                    </div>
                  ) : null}
                  <p>
                    {messages.orderExpires}{" "}
                    {new Intl.DateTimeFormat(messages.locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(order.pendingExpiresAt))}
                  </p>
                  <button type="button" disabled={busy} onClick={() => void cancel()}>
                    {messages.orderCancel}
                  </button>
                </>
              ) : null}
              {order.returnRequest ? (
                <section
                  className="np-shop-return-summary"
                  data-np-shop-return-status={order.returnRequest.status}
                >
                  <h2>{messages.orderReturn}</h2>
                  <p>{returnStatusMessage(order.returnRequest)}</p>
                  <p>
                    {messages.orderReturnReason}: {returnReasonMessage(order.returnRequest.reason)}
                  </p>
                  <ul>
                    {order.returnRequest.lines.map((requestedLine) => {
                      const line = order.lines.find(
                        (candidate) => candidate.key === requestedLine.lineKey,
                      );
                      return (
                        <li key={requestedLine.lineKey}>
                          {line?.productName ?? requestedLine.lineKey} × {requestedLine.quantity}
                        </li>
                      );
                    })}
                  </ul>
                  {order.returnRequest.status === "received" ? (
                    <p>
                      {order.returnRequest.inventoryOutcome === "restocked"
                        ? messages.orderReturnInventoryRestocked
                        : order.returnRequest.inventoryOutcome === "manual-required"
                          ? messages.orderReturnInventoryManual
                          : messages.orderReturnInventoryNotRequired}
                    </p>
                  ) : null}
                  {order.returnRequest.logistics ? (
                    <section
                      className="np-shop-return-logistics-summary"
                      data-np-shop-return-logistics-status={order.returnRequest.logistics.status}
                    >
                      <h3>{messages.orderReturnLogistics}</h3>
                      <p>{returnLogisticsStatusMessage(order.returnRequest.logistics)}</p>
                      {order.returnRequest.logistics.carrier &&
                      order.returnRequest.logistics.trackingNumber ? (
                        <p>
                          {order.returnRequest.logistics.carrier}{" "}
                          {order.returnRequest.logistics.trackingNumber}
                        </p>
                      ) : null}
                      {order.returnRequest.logistics.tracking ? (
                        <p
                          data-np-shop-return-tracking-status={
                            order.returnRequest.logistics.tracking.status
                          }
                        >
                          {returnTrackingStatusMessage(order.returnRequest.logistics)}
                        </p>
                      ) : null}
                      {order.returnRequest.logistics.status === "active" &&
                      returnLogisticsLabelPath ? (
                        <a
                          href={`${returnLogisticsLabelPath}?orderId=${encodeURIComponent(order.id)}&returnId=${encodeURIComponent(order.returnRequest.id)}&logisticsId=${encodeURIComponent(order.returnRequest.logistics.id)}`}
                        >
                          {messages.orderReturnLogisticsLabel}
                        </a>
                      ) : null}
                      {["pending", "provider-confirmed"].includes(
                        order.returnRequest.logistics.status,
                      ) && order.returnRequest.status === "approved" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void resumeReturnShipping()}
                        >
                          {messages.orderReturnLogisticsResume}
                        </button>
                      ) : null}
                      {["active", "cancel-pending", "cancel-confirmed"].includes(
                        order.returnRequest.logistics.status,
                      ) && order.returnRequest.status === "approved" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void cancelReturnShipping()}
                        >
                          {messages.orderReturnLogisticsCancel}
                        </button>
                      ) : null}
                    </section>
                  ) : order.returnRequest.status === "approved" && returnLogisticsApiPath ? (
                    <form
                      className="np-shop-return-logistics-form"
                      onSubmit={(event) => void createReturnShipping(event)}
                    >
                      <h3>{messages.orderReturnLogistics}</h3>
                      <p>{messages.orderReturnLogisticsPrivacy}</p>
                      <label>
                        <span>{messages.orderReturnLogistics}</span>
                        <select
                          name="mode"
                          value={returnLogisticsMode}
                          disabled={busy}
                          onChange={(event) =>
                            setReturnLogisticsMode(
                              event.currentTarget.value === "pickup" ? "pickup" : "dropoff",
                            )
                          }
                        >
                          <option value="dropoff">{messages.orderReturnLogisticsDropoff}</option>
                          <option value="pickup">{messages.orderReturnLogisticsPickup}</option>
                        </select>
                      </label>
                      <label>
                        <span>{messages.orderDraftRecipientName}</span>
                        <input name="recipientName" required maxLength={120} disabled={busy} />
                      </label>
                      <label>
                        <span>{messages.orderDraftPhone}</span>
                        <input name="phone" required maxLength={40} disabled={busy} />
                      </label>
                      <label>
                        <span>{messages.orderDraftCountryCode}</span>
                        <input
                          name="countryCode"
                          required
                          maxLength={2}
                          defaultValue="KR"
                          disabled={busy}
                        />
                      </label>
                      <label>
                        <span>{messages.orderDraftPostalCode}</span>
                        <input name="postalCode" required maxLength={32} disabled={busy} />
                      </label>
                      <label>
                        <span>{messages.orderDraftAddressLine1}</span>
                        <input name="addressLine1" required maxLength={200} disabled={busy} />
                      </label>
                      <label>
                        <span>{messages.orderDraftAddressLine2}</span>
                        <input name="addressLine2" maxLength={200} disabled={busy} />
                      </label>
                      <label>
                        <span>{messages.orderDraftLocality}</span>
                        <input name="locality" required maxLength={120} disabled={busy} />
                      </label>
                      <label>
                        <span>{messages.orderDraftAdministrativeArea}</span>
                        <input name="administrativeArea" maxLength={120} disabled={busy} />
                      </label>
                      {returnLogisticsMode === "pickup" ? (
                        <>
                          <label>
                            <span>{messages.orderReturnLogisticsReadyAt}</span>
                            <input name="readyAt" type="datetime-local" required disabled={busy} />
                          </label>
                          <label>
                            <span>{messages.orderReturnLogisticsCloseAt}</span>
                            <input name="closeAt" type="datetime-local" required disabled={busy} />
                          </label>
                        </>
                      ) : null}
                      <button type="submit" disabled={busy}>
                        {busy
                          ? messages.orderReturnLogisticsCreating
                          : messages.orderReturnLogisticsCreate}
                      </button>
                    </form>
                  ) : null}
                  {order.returnRequest.status === "requested" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void cancelPhysicalReturn()}
                    >
                      {messages.orderReturnCancel}
                    </button>
                  ) : null}
                </section>
              ) : order.fulfillment?.status === "shipped" ? (
                <form
                  className="np-shop-return-form"
                  onSubmit={(event) => void requestPhysicalReturn(event)}
                >
                  <h2>{messages.orderReturn}</h2>
                  <p>{messages.orderReturnPolicy}</p>
                  {order.lines.map((line) => (
                    <label key={line.key}>
                      <span>{line.productName}</span>
                      <input
                        type="number"
                        name={`line:${line.key}`}
                        min={0}
                        max={line.quantity}
                        defaultValue={0}
                        disabled={busy}
                      />
                    </label>
                  ))}
                  <label>
                    <span>{messages.orderReturnReason}</span>
                    <select name="reason" defaultValue="changed-mind" disabled={busy}>
                      <option value="damaged">{messages.orderReturnReasonDamaged}</option>
                      <option value="defective">{messages.orderReturnReasonDefective}</option>
                      <option value="wrong-item">{messages.orderReturnReasonWrongItem}</option>
                      <option value="changed-mind">{messages.orderReturnReasonChangedMind}</option>
                      <option value="other">{messages.orderReturnReasonOther}</option>
                    </select>
                  </label>
                  <label>
                    <span>{messages.orderReturnDetail}</span>
                    <textarea name="detail" maxLength={500} disabled={busy} />
                  </label>
                  <button type="submit" disabled={busy}>
                    {busy ? messages.orderReturnSubmitting : messages.orderReturnSubmit}
                  </button>
                </form>
              ) : null}
              <a href={`${basePath}/orders`}>{messages.orderHistory}</a>
            </aside>
          </div>
        </>
      ) : busy ? (
        <p>{messages.orderCreating}</p>
      ) : (
        <a href={`${basePath}/orders`}>{messages.orderHistory}</a>
      )}
    </div>
  );
}

function readMemberCsrf(): string | null {
  if (typeof document === "undefined") return null;
  const match = /(?:^|;\s*)np-mb-csrf=([^;]+)/u.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function uploadReviewPhoto(file: File): Promise<NpShopProductReviewPhoto> {
  if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
    throw new Error("Review photos must be images no larger than 5 MB.");
  }
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/members/media/attachments", {
    method: "POST",
    credentials: "include",
    headers: readMemberCsrf() ? { "X-CSRF-Token": readMemberCsrf() as string } : {},
    body: formData,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("The review photo could not be uploaded.");
  const media = npRequireMediaAttachmentWire(payload);
  if (!media.mimeType.startsWith("image/")) {
    throw new Error("Only image attachments can be used in reviews.");
  }
  return { id: media.id, url: media.downloadUrl };
}

async function deleteReviewPhoto(id: string): Promise<void> {
  const csrf = readMemberCsrf();
  const response = await fetch(`/api/members/media/attachments/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new Error("The review photo could not be removed.");
  }
}

export function ShopProductReviews({
  apiPath,
  productId,
  productPath,
  initialPage,
  messages,
  signedIn,
}: {
  apiPath: string;
  productId: string;
  productPath: string;
  initialPage: NpShopProductReviewPage;
  messages: NpShopReviewClientMessages;
  signedIn: boolean;
}) {
  const labels = messages;
  const locale = messages.locale;
  const ownReview = initialPage.reviews.find((review) => review.ownedByViewer) ?? null;
  const [rating, setRating] = useState(ownReview?.rating ?? 5);
  const [title, setTitle] = useState(ownReview?.title ?? "");
  const [body, setBody] = useState(ownReview?.body ?? "");
  const [photos, setPhotos] = useState<NpShopProductReviewPhoto[]>(ownReview?.photos ?? []);
  const [purchaseToken, setPurchaseToken] = useState(
    initialPage.eligibility[0]?.purchaseToken ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function mutate(method: "POST" | "PATCH" | "DELETE", payload: unknown): Promise<void> {
    const csrf = readMemberCsrf();
    const response = await fetch(apiPath, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => null)) as { message?: unknown } | null;
    if (!response.ok) {
      throw new Error(typeof result?.message === "string" ? result.message : labels.failed);
    }
  }

  async function saveReview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (ownReview) {
        await mutate("PATCH", {
          reviewId: ownReview.id,
          rating,
          title,
          body,
          photos: photos.map((photo) => photo.id),
        });
      } else {
        await mutate("POST", {
          productId,
          purchaseToken,
          rating,
          title,
          body,
          photos: photos.map((photo) => photo.id),
        });
      }
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.failed);
      setBusy(false);
    }
  }

  async function addPhotos(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const available = Math.max(0, 5 - photos.length);
      const uploaded = await Promise.all([...files].slice(0, available).map(uploadReviewPhoto));
      setPhotos((current) => [...current, ...uploaded]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.failed);
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(photo: NpShopProductReviewPhoto): Promise<void> {
    setPhotos((current) => current.filter((candidate) => candidate.id !== photo.id));
    if (!ownReview?.photos.some((candidate) => candidate.id === photo.id)) {
      await deleteReviewPhoto(photo.id).catch(() => undefined);
    }
  }

  async function removeReview(): Promise<void> {
    if (!ownReview) return;
    setBusy(true);
    setError("");
    try {
      await mutate("DELETE", { reviewId: ownReview.id });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.failed);
      setBusy(false);
    }
  }

  return (
    <section className="np-shop-reviews" data-np-shop-reviews>
      <header className="np-shop-review-summary">
        <div>
          <h2>{labels.heading}</h2>
          <strong>
            {initialPage.aggregate.count > 0
              ? `${(initialPage.aggregate.averageRatingBasisPoints / 1_000).toFixed(1)} / 5`
              : "—"}
          </strong>
          <span>{initialPage.aggregate.count.toLocaleString(locale)}</span>
        </div>
        <div className="np-shop-review-distribution">
          {[5, 4, 3, 2, 1].map((star) => (
            <div key={star}>
              <span>{star}★</span>
              <progress
                max={Math.max(1, initialPage.aggregate.count)}
                value={initialPage.aggregate.distribution[star as 1 | 2 | 3 | 4 | 5]}
              />
              <span>{initialPage.aggregate.distribution[star as 1 | 2 | 3 | 4 | 5]}</span>
            </div>
          ))}
        </div>
      </header>
      <div className="np-shop-review-list">
        {initialPage.reviews.length === 0 ? <p>{labels.empty}</p> : null}
        {initialPage.reviews.map((review: NpShopProductReview) => (
          <article key={review.id} data-np-shop-review>
            <header>
              <strong>{"★".repeat(review.rating)}</strong>
              <span>{labels.verified}</span>
              <span>{review.author?.displayName ?? "—"}</span>
              <time dateTime={review.createdAt}>
                {new Date(review.createdAt).toLocaleDateString(locale)}
              </time>
            </header>
            <h3>{review.title}</h3>
            <p>{review.body}</p>
            {review.photos.length > 0 ? (
              <div className="np-shop-review-photos">
                {review.photos.map((photo) => (
                  <img key={photo.id} src={photo.url} alt="" loading="lazy" />
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {initialPage.totalPages > 1 ? (
        <nav className="np-shop-review-pagination" aria-label={labels.heading}>
          {initialPage.page > 1 ? (
            <a href={`${productPath}?reviewPage=${(initialPage.page - 1).toString()}`}>
              {labels.previous}
            </a>
          ) : (
            <span />
          )}
          <span>
            {initialPage.page.toLocaleString(locale)} /{" "}
            {initialPage.totalPages.toLocaleString(locale)}
          </span>
          {initialPage.page < initialPage.totalPages ? (
            <a href={`${productPath}?reviewPage=${(initialPage.page + 1).toString()}`}>
              {labels.next}
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
      {!signedIn ? <p>{labels.login}</p> : null}
      {signedIn && !ownReview && initialPage.eligibility.length === 0 ? (
        <p>{labels.unavailable}</p>
      ) : null}
      {signedIn && (ownReview || initialPage.eligibility.length > 0) ? (
        <form data-np-shop-review-form onSubmit={(event) => void saveReview(event)}>
          <h3>{ownReview ? labels.edit : labels.write}</h3>
          {!ownReview && initialPage.eligibility.length > 1 ? (
            <label>
              <span>{labels.purchase}</span>
              <select
                value={purchaseToken}
                onChange={(event) => setPurchaseToken(event.target.value)}
              >
                {initialPage.eligibility.map((entry) => (
                  <option key={entry.purchaseToken} value={entry.purchaseToken}>
                    {entry.variantName ?? new Date(entry.purchasedAt).toLocaleDateString(locale)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>{labels.rating}</span>
            <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
              {[5, 4, 3, 2, 1].map((value) => (
                <option key={value} value={value}>{`${value.toString()} ★`}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{labels.title}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label>
            <span>{labels.body}</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={2_000}
              required
            />
          </label>
          <fieldset>
            <legend>{labels.photos}</legend>
            <div className="np-shop-review-photos">
              {photos.map((photo) => (
                <div key={photo.id}>
                  <img src={photo.url} alt="" />
                  <button type="button" onClick={() => void removePhoto(photo)}>
                    {labels.remove}
                  </button>
                </div>
              ))}
            </div>
            <label>
              <span>{labels.upload}</span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={busy || photos.length >= 5}
                onChange={(event) => void addPhotos(event.target.files)}
              />
            </label>
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? labels.saving : labels.save}
          </button>
          {ownReview ? (
            <button type="button" disabled={busy} onClick={() => void removeReview()}>
              {labels.delete}
            </button>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

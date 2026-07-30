"use client";

import { useEffect, useRef, useState } from "react";

import { npRequireShopCartQuote } from "./cart-contract.js";
import { npRequireShopCheckoutIntent } from "./checkout-contract.js";
import type {
  NpShopCartClientMessages,
  NpShopCartQuote,
  NpShopCheckoutIntent,
  NpShopCurrency,
  NpShopProduct,
} from "./types.js";

interface CartResponse {
  quote: NpShopCartQuote;
  csrfToken: string | null;
}

interface CheckoutResponse {
  intent: NpShopCheckoutIntent;
  csrfToken: string | null;
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
  method: "GET" | "POST" | "PATCH" | "DELETE",
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

  async function mutate(method: "PATCH" | "DELETE", body: Record<string, unknown>): Promise<void> {
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
            <h2>{messages.cartSubtotal}</h2>
            {quote.totals.map((total) => (
              <strong key={total.currency}>
                {formatMoney(messages.locale, total.subtotalMinor, total.currency)}
              </strong>
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
  basePath,
  intentId,
  messages,
}: {
  apiPath: string;
  basePath: string;
  intentId: string;
  messages: NpShopCartClientMessages;
}) {
  const [intent, setIntent] = useState<NpShopCheckoutIntent | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
            <p>
              {messages.checkoutExpires}{" "}
              {new Intl.DateTimeFormat(messages.locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(intent.expiresAt))}
            </p>
            <p>{messages.checkoutPaymentUnavailable}</p>
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

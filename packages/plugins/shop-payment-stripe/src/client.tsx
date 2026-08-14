"use client";

import { useEffect, useRef, useState } from "react";

import type { NpShopPaymentAttempt, NpShopPaymentLauncherProps } from "@nexpress/plugin-shop";

interface StripeHandoffData {
  sdkUrl: string;
  publishableKey: string;
  paymentIntentId: string;
  intentToken: string;
  orderId: string;
  amountMinor: number;
  currency: "KRW" | "USD" | "EUR" | "JPY";
  returnUrl: string;
}

interface StripePaymentElement {
  mount(target: HTMLElement): void;
  unmount(): void;
}

interface StripeElements {
  create(kind: "payment"): StripePaymentElement;
}

interface StripePaymentIntentResult {
  id: string;
  status: string;
}

interface StripeInstance {
  elements(input: { clientSecret: string }): StripeElements;
  confirmPayment(input: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: "if_required";
  }): Promise<{
    error?: { message?: string };
    paymentIntent?: StripePaymentIntentResult;
  }>;
}

const publishableKeyPattern = /^pk_(?:test|live)_[A-Za-z0-9_]{8,220}$/u;
const paymentIntentPattern = /^pi_[A-Za-z0-9]{8,200}$/u;

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeInstance;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStripeData(attempt: NpShopPaymentAttempt): StripeHandoffData {
  const handoff = attempt.handoff;
  if (handoff.providerId !== "stripe" || handoff.kind !== "client") {
    throw new Error("The payment handoff does not belong to Stripe.");
  }
  const data = handoff.data;
  const expected = [
    "sdkUrl",
    "publishableKey",
    "paymentIntentId",
    "intentToken",
    "orderId",
    "amountMinor",
    "currency",
    "returnUrl",
  ];
  let returnUrl: URL | null = null;
  try {
    returnUrl = new URL(typeof data.returnUrl === "string" ? data.returnUrl : "");
  } catch {
    // The shared malformed-handoff branch below owns the client-safe error.
  }
  if (
    Object.keys(data).length !== expected.length ||
    !Object.keys(data).every((key) => expected.includes(key)) ||
    data.sdkUrl !== "https://js.stripe.com/v3" ||
    typeof data.publishableKey !== "string" ||
    !publishableKeyPattern.test(data.publishableKey) ||
    typeof data.paymentIntentId !== "string" ||
    !paymentIntentPattern.test(data.paymentIntentId) ||
    typeof data.intentToken !== "string" ||
    data.intentToken.length > 500 ||
    !data.intentToken.startsWith(`${data.paymentIntentId}_secret_`) ||
    data.orderId !== attempt.orderId ||
    data.amountMinor !== attempt.amountMinor ||
    data.currency !== attempt.currency ||
    !returnUrl ||
    returnUrl.origin !== window.location.origin ||
    !returnUrl.pathname.endsWith(`/orders/${attempt.orderId}`) ||
    returnUrl.searchParams.get("npPayment") !== "success" ||
    returnUrl.searchParams.get("attempt") !== attempt.id
  ) {
    throw new Error("The Stripe handoff is malformed.");
  }
  return data as unknown as StripeHandoffData;
}

async function loadSdk(url: string): Promise<void> {
  if (window.Stripe) return;
  document.querySelector<HTMLScriptElement>(`script[src="${url}"]`)?.remove();
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(new Error("Stripe.js failed to load."));
      },
      { once: true },
    );
    document.head.append(script);
  });
  if (!window.Stripe) throw new Error("Stripe.js did not initialize.");
}

async function requestJson(
  path: string,
  method: "GET" | "POST" | "PATCH",
  input: { csrfToken?: string | null; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
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
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) throw new Error("The payment response was invalid.");
  if (!response.ok) {
    throw new Error(typeof payload.message === "string" ? payload.message : "Payment failed.");
  }
  return payload;
}

function clearProviderQuery(): void {
  const url = new URL(window.location.href);
  for (const key of [
    "npPayment",
    "attempt",
    "payment_intent",
    "payment_intent_client_secret",
    "redirect_status",
  ]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function StripePaymentLauncher(props: NpShopPaymentLauncherProps) {
  const [attempt, setAttempt] = useState<NpShopPaymentAttempt | null>(null);
  const [data, setData] = useState<StripeHandoffData | null>(null);
  const [state, setState] = useState<"preparing" | "ready" | "confirming" | "error">("preparing");
  const [error, setError] = useState("");
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const elementRef = useRef<StripePaymentElement | null>(null);
  const generation = useRef(0);

  function clearElement(): void {
    elementRef.current?.unmount();
    elementRef.current = null;
    elementsRef.current = null;
    stripeRef.current = null;
  }

  async function mountPaymentElement(nextData: StripeHandoffData): Promise<void> {
    await loadSdk(nextData.sdkUrl);
    if (!window.Stripe || !mountRef.current) throw new Error("Stripe.js is unavailable.");
    clearElement();
    const stripe = window.Stripe(nextData.publishableKey);
    const elements = stripe.elements({ clientSecret: nextData.intentToken });
    const element = elements.create("payment");
    element.mount(mountRef.current);
    stripeRef.current = stripe;
    elementsRef.current = elements;
    elementRef.current = element;
  }

  async function prepare(): Promise<void> {
    const currentGeneration = ++generation.current;
    setState("preparing");
    setError("");
    const tokenResponse = await requestJson(props.attemptApiPath, "GET");
    const csrfToken = typeof tokenResponse.csrfToken === "string" ? tokenResponse.csrfToken : null;
    const response = await requestJson(props.attemptApiPath, "POST", {
      csrfToken,
      body: { orderId: props.orderId, idempotencyKey: crypto.randomUUID() },
    });
    if (!isRecord(response.attempt)) throw new Error("The payment attempt was missing.");
    const nextAttempt = response.attempt as unknown as NpShopPaymentAttempt;
    const nextData = requireStripeData(nextAttempt);
    setAttempt(nextAttempt);
    setData(nextData);
    await mountPaymentElement(nextData);
    if (generation.current !== currentGeneration) return;
    setState("ready");
  }

  async function submitConfirmation(attemptId: string, paymentIntentId: string): Promise<void> {
    const tokenResponse = await requestJson(
      `${props.attemptApiPath}?orderId=${encodeURIComponent(props.orderId)}&attemptId=${encodeURIComponent(attemptId)}`,
      "GET",
    );
    const csrfToken = typeof tokenResponse.csrfToken === "string" ? tokenResponse.csrfToken : null;
    await requestJson(props.attemptApiPath, "PATCH", {
      csrfToken,
      body: {
        attemptId,
        orderId: props.orderId,
        confirmation: { paymentIntentId },
      },
    });
    clearProviderQuery();
    window.location.reload();
  }

  async function confirmProviderReturn(): Promise<void> {
    const query = new URL(window.location.href).searchParams;
    const attemptId = query.get("attempt");
    const paymentIntentId = query.get("payment_intent");
    if (
      query.get("npPayment") !== "success" ||
      !attemptId ||
      !paymentIntentId ||
      !paymentIntentPattern.test(paymentIntentId)
    ) {
      throw new Error(props.failedLabel);
    }
    setState("confirming");
    setError("");
    await submitConfirmation(attemptId, paymentIntentId);
  }

  function reportFailure(caught: unknown): void {
    setError(caught instanceof Error ? caught.message : props.failedLabel);
    setState("error");
  }

  useEffect(() => {
    const query = new URL(window.location.href).searchParams;
    if (query.get("npPayment") === "success" && query.get("attempt")) {
      if (query.get("redirect_status") === "requires_payment_method") {
        clearProviderQuery();
        setError(props.failedLabel);
        setState("error");
        return;
      }
      void confirmProviderReturn().catch(reportFailure);
      return;
    }
    void prepare().catch(reportFailure);
    return () => clearElement();
  }, [props.attemptApiPath, props.failedLabel, props.orderId]);

  async function launch(): Promise<void> {
    if (!attempt || !data || !stripeRef.current || !elementsRef.current || state !== "ready") {
      return;
    }
    setError("");
    setState("confirming");
    try {
      const result = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: { return_url: data.returnUrl },
        redirect: "if_required",
      });
      if (result.error) throw new Error(result.error.message || props.failedLabel);
      if (!result.paymentIntent || result.paymentIntent.status !== "succeeded") {
        throw new Error(props.failedLabel);
      }
      await submitConfirmation(attempt.id, result.paymentIntent.id);
    } catch (caught) {
      reportFailure(caught);
    }
  }

  async function retry(): Promise<void> {
    const query = new URL(window.location.href).searchParams;
    try {
      if (query.get("npPayment") === "success" && query.get("attempt")) {
        await confirmProviderReturn();
        return;
      }
      if (attempt && data) {
        setState("preparing");
        setError("");
        await mountPaymentElement(data);
        setState("ready");
        return;
      }
      await prepare();
    } catch (caught) {
      reportFailure(caught);
    }
  }

  return (
    <div className="np-shop-stripe-payment" data-np-shop-payment-provider="stripe">
      {error ? <p role="alert">{error}</p> : null}
      {state === "confirming" ? <p>{props.confirmingLabel}</p> : null}
      {state === "preparing" ? <p>{props.preparingLabel}</p> : null}
      <div ref={mountRef} hidden={state === "error" || state === "confirming"} />
      {state === "ready" ? (
        <button type="button" onClick={() => void launch()}>
          {props.label}
        </button>
      ) : null}
      {state === "error" ? (
        <button type="button" onClick={() => void retry()}>
          {props.retryLabel}
        </button>
      ) : null}
    </div>
  );
}

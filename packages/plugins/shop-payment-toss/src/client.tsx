"use client";

import { useEffect, useRef, useState } from "react";

import type { NpShopPaymentAttempt, NpShopPaymentLauncherProps } from "@nexpress/plugin-shop";

interface TossHandoffData {
  sdkUrl: string;
  clientKey: string;
  customerKey: string;
  method: "CARD";
  orderId: string;
  orderName: string;
  amountMinor: number;
  currency: "KRW";
  successUrl: string;
  failUrl: string;
}

interface TossPaymentInstance {
  requestPayment(input: {
    method: "CARD";
    amount: { value: number; currency: "KRW" };
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
  }): Promise<void> | void;
}

interface TossSdk {
  payment(input: { customerKey: string }): TossPaymentInstance;
}

const clientKeyPattern = /^(?:test|live)_g?ck_[A-Za-z0-9_-]{8,180}$/u;

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => TossSdk;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireTossData(attempt: NpShopPaymentAttempt): TossHandoffData {
  const handoff = attempt.handoff;
  if (handoff.providerId !== "toss-payments" || handoff.kind !== "client") {
    throw new Error("The payment handoff does not belong to Toss Payments.");
  }
  const data = handoff.data;
  const expected = [
    "sdkUrl",
    "clientKey",
    "customerKey",
    "method",
    "orderId",
    "orderName",
    "amountMinor",
    "currency",
    "successUrl",
    "failUrl",
  ];
  let successUrl: URL | null = null;
  let failUrl: URL | null = null;
  try {
    successUrl = new URL(typeof data.successUrl === "string" ? data.successUrl : "");
    failUrl = new URL(typeof data.failUrl === "string" ? data.failUrl : "");
  } catch {
    // The shared malformed-handoff branch below owns the client-safe error.
  }
  const validReturnUrl = (url: URL | null, mode: "success" | "fail") =>
    url !== null &&
    url.origin === window.location.origin &&
    url.pathname.endsWith(`/orders/${attempt.orderId}`) &&
    url.searchParams.get("npPayment") === mode &&
    url.searchParams.get("attempt") === attempt.id;
  if (
    Object.keys(data).length !== expected.length ||
    !Object.keys(data).every((key) => expected.includes(key)) ||
    typeof data.sdkUrl !== "string" ||
    data.sdkUrl !== "https://js.tosspayments.com/v2/standard" ||
    typeof data.clientKey !== "string" ||
    !clientKeyPattern.test(data.clientKey) ||
    data.customerKey !== "ANONYMOUS" ||
    data.method !== "CARD" ||
    data.orderId !== attempt.orderId ||
    typeof data.orderName !== "string" ||
    data.orderName.trim() !== data.orderName ||
    data.orderName.length < 1 ||
    data.orderName.length > 100 ||
    typeof data.amountMinor !== "number" ||
    !Number.isSafeInteger(data.amountMinor) ||
    data.amountMinor < 1 ||
    data.amountMinor !== attempt.amountMinor ||
    data.currency !== "KRW" ||
    !validReturnUrl(successUrl, "success") ||
    !validReturnUrl(failUrl, "fail")
  ) {
    throw new Error("The Toss Payments handoff is malformed.");
  }
  return data as unknown as TossHandoffData;
}

async function loadSdk(url: string): Promise<void> {
  if (window.TossPayments) return;
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
        reject(new Error("Toss SDK failed to load."));
      },
      { once: true },
    );
    document.head.append(script);
  });
  if (!window.TossPayments) throw new Error("Toss SDK did not initialize.");
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
    "paymentKey",
    "orderId",
    "amount",
    "code",
    "message",
  ]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function TossPaymentLauncher(props: NpShopPaymentLauncherProps) {
  const [attempt, setAttempt] = useState<NpShopPaymentAttempt | null>(null);
  const [data, setData] = useState<TossHandoffData | null>(null);
  const [state, setState] = useState<"preparing" | "ready" | "confirming" | "error">("preparing");
  const [error, setError] = useState("");
  const generation = useRef(0);

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
    const nextData = requireTossData(nextAttempt);
    await loadSdk(nextData.sdkUrl);
    if (generation.current !== currentGeneration) return;
    setAttempt(nextAttempt);
    setData(nextData);
    setState("ready");
  }

  useEffect(() => {
    const query = new URL(window.location.href).searchParams;
    const mode = query.get("npPayment");
    const attemptId = query.get("attempt");
    if (mode === "success" && attemptId) {
      setState("confirming");
      void requestJson(
        `${props.attemptApiPath}?orderId=${encodeURIComponent(props.orderId)}&attemptId=${encodeURIComponent(attemptId)}`,
        "GET",
      )
        .then(async (tokenResponse) => {
          const csrfToken =
            typeof tokenResponse.csrfToken === "string" ? tokenResponse.csrfToken : null;
          const paymentKey = query.get("paymentKey");
          const returnedOrderId = query.get("orderId");
          const amountText = query.get("amount");
          const amount = amountText && /^\d+$/u.test(amountText) ? Number(amountText) : NaN;
          await requestJson(props.attemptApiPath, "PATCH", {
            csrfToken,
            body: {
              attemptId,
              orderId: props.orderId,
              confirmation: { paymentKey, orderId: returnedOrderId, amount },
            },
          });
          clearProviderQuery();
          window.location.reload();
        })
        .catch((caught: unknown) => {
          clearProviderQuery();
          setError(caught instanceof Error ? caught.message : props.failedLabel);
          setState("error");
        });
      return;
    }
    if (mode === "fail") {
      clearProviderQuery();
      setError(props.failedLabel);
      setState("error");
      return;
    }
    void prepare().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : props.failedLabel);
      setState("error");
    });
  }, [props.attemptApiPath, props.failedLabel, props.orderId]);

  async function launch(): Promise<void> {
    if (!attempt || !data || !window.TossPayments || state !== "ready") return;
    setError("");
    try {
      const payment = window.TossPayments(data.clientKey).payment({
        customerKey: data.customerKey,
      });
      await payment.requestPayment({
        method: data.method,
        amount: { value: data.amountMinor, currency: data.currency },
        orderId: data.orderId,
        orderName: data.orderName,
        successUrl: data.successUrl,
        failUrl: data.failUrl,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : props.failedLabel);
      setState("ready");
    }
  }

  return (
    <div className="np-shop-toss-payment" data-np-shop-payment-provider="toss-payments">
      {error ? <p role="alert">{error}</p> : null}
      {state === "confirming" ? <p>{props.confirmingLabel}</p> : null}
      {state === "preparing" ? <p>{props.preparingLabel}</p> : null}
      {state === "ready" ? (
        <button type="button" onClick={() => void launch()}>
          {props.label}
        </button>
      ) : null}
      {state === "error" ? (
        <button type="button" onClick={() => void prepare()}>
          {props.retryLabel}
        </button>
      ) : null}
    </div>
  );
}

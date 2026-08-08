"use client";

import { useState } from "react";

import { npRequireShopPriceAlertMutationWire } from "./price-alert-contract.js";
import type { NpShopProduct, NpShopProductSummary } from "./types.js";

export interface ShopPriceAlertProps {
  apiPath: string;
  product: NpShopProduct | NpShopProductSummary;
  initialVariantSkus: Array<string | null>;
  signedIn: boolean;
  loginHref: string;
  labels: {
    heading: string;
    select: string;
    subscribe: string;
    subscribed: string;
    saving: string;
    signIn: string;
    unavailable: string;
    failed: string;
  };
}

function readMemberCsrf(): string | null {
  if (typeof document === "undefined") return null;
  const match = /(?:^|;\s*)np-mb-csrf=([^;]+)/u.exec(document.cookie);
  const value = match?.[1];
  return value === undefined ? null : decodeURIComponent(value);
}

export function ShopPriceAlert(props: ShopPriceAlertProps) {
  const variants =
    "variants" in props.product ? props.product.variants.filter((variant) => variant.enabled) : [];
  const targets = [
    { variantSku: null, label: props.product.name, priceMinor: props.product.priceMinor },
    ...variants.map((variant) => ({
      variantSku: variant.sku,
      label: variant.optionSummary ?? variant.name,
      priceMinor: variant.priceMinor ?? props.product.priceMinor,
    })),
  ].filter((target) => target.priceMinor > 0);
  const [selectedSku, setSelectedSku] = useState<string | null>(targets[0]?.variantSku ?? null);
  const [active, setActive] = useState(() => new Set(props.initialVariantSkus));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = targets.find((target) => target.variantSku === selectedSku) ?? targets[0];

  if (targets.length === 0) return null;
  if (!props.signedIn) {
    return (
      <section className="np-shop-price-alert" data-np-shop-price-alert="signed-out">
        <strong>{props.labels.heading}</strong>
        <a href={props.loginHref}>{props.labels.signIn}</a>
      </section>
    );
  }

  async function toggle(): Promise<void> {
    if (!selected || busy) return;
    const wasActive = active.has(selected.variantSku);
    setBusy(true);
    setError("");
    try {
      const csrf = readMemberCsrf();
      const response = await fetch(props.apiPath, {
        method: wasActive ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ productId: props.product.id, variantSku: selected.variantSku }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          typeof (payload as { message?: unknown }).message === "string"
            ? (payload as { message: string }).message
            : props.labels.failed;
        throw new Error(message);
      }
      const result = npRequireShopPriceAlertMutationWire(payload);
      setActive((current) => {
        const next = new Set(current);
        if (result.alert) next.add(result.alert.variantSku);
        else next.delete(selected.variantSku);
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : props.labels.failed);
    } finally {
      setBusy(false);
    }
  }

  const subscribed = selected ? active.has(selected.variantSku) : false;
  return (
    <section
      className="np-shop-price-alert"
      data-np-shop-price-alert={subscribed ? "subscribed" : "available"}
    >
      <strong>{props.labels.heading}</strong>
      {targets.length > 1 ? (
        <label>
          <span>{props.labels.select}</span>
          <select
            value={selectedSku ?? ""}
            onChange={(event) => {
              setSelectedSku(event.target.value || null);
              setError("");
            }}
            disabled={busy}
          >
            {targets.map((target) => (
              <option key={target.variantSku ?? "_"} value={target.variantSku ?? ""}>
                {target.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span>{selected?.label ?? props.labels.unavailable}</span>
      )}
      <button
        type="button"
        aria-pressed={subscribed}
        disabled={busy || !selected}
        onClick={() => void toggle()}
      >
        {busy ? props.labels.saving : subscribed ? props.labels.subscribed : props.labels.subscribe}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </section>
  );
}

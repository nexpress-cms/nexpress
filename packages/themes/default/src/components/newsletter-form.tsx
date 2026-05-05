"use client";

import { useState } from "react";

/**
 * Lightweight newsletter form. Submits to `/api/newsletter`
 * (operators wire this up in their app, or hand it off to a
 * provider like ConvertKit / Buttondown via a small route
 * handler). When the endpoint isn't present we degrade
 * gracefully — the user sees an "endpoint not configured"
 * notice rather than a stack trace.
 *
 * Optimistic UX: the input is replaced by a "thanks" message
 * the moment the response is OK. Errors keep the input visible
 * so the user can retry.
 */
export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "ok" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "submitting") return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 404) {
        setState({
          kind: "error",
          message: "Newsletter endpoint not configured.",
        });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setState({
          kind: "error",
          message: body?.error?.message ?? "Subscription failed. Try again.",
        });
        return;
      }
      setState({ kind: "ok" });
      setEmail("");
    } catch {
      setState({ kind: "error", message: "Network error." });
    }
  }

  if (state.kind === "ok") {
    return (
      <p className="np-site-footer-subscribe-success" role="status">
        Thanks — you're subscribed.
      </p>
    );
  }

  return (
    <form
      className="np-site-footer-subscribe-form"
      onSubmit={(e) => {
        void onSubmit(e);
      }}
    >
      <label className="sr-only" htmlFor="np-newsletter-email">
        Email address
      </label>
      <input
        id="np-newsletter-email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" disabled={state.kind === "submitting"}>
        {state.kind === "submitting" ? "Subscribing…" : "Subscribe"}
      </button>
      {state.kind === "error" ? (
        <p className="np-site-footer-subscribe-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useState } from "react";

/**
 * Magazine theme's "Subscribe" form — submits to /api/newsletter
 * (operators wire this up to ConvertKit / Buttondown / their own
 * backend). Inline single-row layout intended for footer placement.
 */
export function MagazineNewsletterForm() {
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
        setState({ kind: "error", message: "Newsletter endpoint not configured." });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setState({ kind: "error", message: body?.error?.message ?? "Failed. Try again." });
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
      <p className="np-magazine-subscribe-success" role="status">
        Subscribed. We'll be in touch.
      </p>
    );
  }

  return (
    <form
      className="np-magazine-subscribe-form"
      onSubmit={(e) => {
        void onSubmit(e);
      }}
    >
      <label className="sr-only" htmlFor="np-magazine-newsletter">
        Email address
      </label>
      <input
        id="np-magazine-newsletter"
        type="email"
        required
        autoComplete="email"
        placeholder="reader@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" disabled={state.kind === "submitting"}>
        {state.kind === "submitting" ? "Sending…" : "Subscribe"}
      </button>
      {state.kind === "error" ? (
        <p className="np-magazine-subscribe-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

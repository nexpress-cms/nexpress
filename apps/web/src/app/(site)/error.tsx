"use client";

/**
 * Phase F.7 — public-site error boundary fallback.
 *
 * Next requires `error.tsx` to be a client component (Next
 * convention). Theme `impl.error` is a server-side reference
 * declared in the theme package, so React's server →client
 * boundary blocks the framework from generically delegating to
 * it from this file.
 *
 * The pragmatic v0.2 contract:
 *   - This file ships a sensible framework default that any
 *     site gets out of the box.
 *   - Themes that want custom error UI ship their own client
 *     component in their package and document a one-line
 *     override snippet for operators to drop into this file
 *     (or replace it wholesale).
 *
 * `impl.error` on `NpThemeImpl` exists for type-system
 * consistency with `notFound` and forward-compatibility — a
 * future Next API for server-rendered error fallbacks would
 * let the framework wire it transparently.
 */

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function SiteError({ error, reset }: ErrorPageProps) {
  return (
    <main
      className="np-error"
      style={{
        maxWidth: 480,
        margin: "6rem auto",
        padding: "0 1.5rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Something went wrong</h1>
      <p style={{ margin: "1rem 0 0", color: "#64748b" }}>
        {process.env.NODE_ENV === "production"
          ? "Please try again in a moment."
          : error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: "1.5rem",
          padding: "0.5rem 1.25rem",
          borderRadius: "0.375rem",
          border: "1px solid #cbd5e1",
          background: "white",
          cursor: "pointer",
          fontSize: "0.875rem",
        }}
      >
        Try again
      </button>
    </main>
  );
}

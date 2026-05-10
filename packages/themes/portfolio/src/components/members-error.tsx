"use client";

/**
 * Portfolio theme's member-tree error boundary fallback.
 *
 * Same delegation pattern as magazine's: Next requires
 * `(member)/error.tsx` to be a client component, so theme error
 * UI ships as a separate client subpath that the host's
 * error.tsx lazy-imports based on the active theme. The theme's
 * `impl.members.error` slot stays as a forward-compat type
 * marker; the actual rendering goes through this client entry.
 *
 * Imported as `@nexpress/theme-portfolio/components/members-error`
 * by `apps/web/src/app/(member)/error.tsx`.
 *
 * Tone matches the portfolio aesthetic — minimal, restrained,
 * with the same "Back to sign in" CTA as other member error
 * surfaces (the common cause of an error inside `/members/*` is
 * stale session state).
 */

interface PortfolioMembersErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PortfolioMembersError({
  error,
  reset,
}: PortfolioMembersErrorProps) {
  return (
    <div
      className="np-portfolio np-portfolio-members-error"
      style={{
        maxWidth: 480,
        margin: "6rem auto",
        padding: "0 1.5rem",
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "var(--np-color-muted-foreground, #94a3b8)",
          fontFamily: "var(--np-font-body)",
        }}
      >
        Account
      </p>
      <h1
        style={{
          margin: "1rem 0 0",
          fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
          fontFamily: "var(--np-font-heading)",
          fontWeight: 500,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        Something interrupted your session.
      </h1>
      <p
        style={{
          margin: "1.25rem 0 0",
          color: "var(--np-color-muted-foreground, #94a3b8)",
          fontSize: "0.9375rem",
          lineHeight: 1.6,
        }}
      >
        {process.env.NODE_ENV === "production"
          ? "Try again, or sign back in to start fresh."
          : error.message}
      </p>
      <div
        style={{
          marginTop: "2rem",
          display: "flex",
          gap: "0.75rem",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.625rem 1.5rem",
            fontFamily: "inherit",
            fontSize: "0.875rem",
            fontWeight: 500,
            background: "var(--np-color-primary, #0f172a)",
            color: "var(--np-color-primary-foreground, #fff)",
            border: "none",
            borderRadius: "0.25rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <a
          href="/members/login"
          style={{
            padding: "0.625rem 1.5rem",
            fontFamily: "inherit",
            fontSize: "0.875rem",
            fontWeight: 500,
            background: "transparent",
            color: "var(--np-color-foreground)",
            border: "1px solid var(--np-color-border, #e2e8f0)",
            borderRadius: "0.25rem",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Back to sign in
        </a>
      </div>
    </div>
  );
}

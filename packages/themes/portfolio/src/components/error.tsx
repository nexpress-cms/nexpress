"use client";

/**
 * Portfolio theme's public-site error boundary fallback.
 *
 * Same delegation pattern as `./members-error.tsx`: Next requires
 * `(site)/error.tsx` to be a client component, so theme error UI
 * ships as a separate client subpath that the host's error.tsx
 * lazy-imports based on the active theme.
 *
 * Imported as `@nexpress/theme-portfolio/components/error` by
 * `apps/web/src/app/(site)/error.tsx`'s registry.
 *
 * Tone matches the portfolio aesthetic — minimal, restrained.
 * No "Back to sign in" CTA here (that's the member-side concern);
 * just a "Try again" button + a link back to home.
 */

interface PortfolioErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PortfolioError({
  error,
  reset,
}: PortfolioErrorProps) {
  return (
    <div
      className="np-portfolio np-portfolio-error"
      style={{
        maxWidth: 560,
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
        Server error
      </p>
      <h1
        style={{
          margin: "1rem 0 0",
          fontSize: "clamp(1.75rem, 4vw, 2.75rem)",
          fontFamily: "var(--np-font-heading)",
          fontWeight: 500,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        Something didn&rsquo;t load.
      </h1>
      <p
        style={{
          margin: "1.25rem auto 0",
          maxWidth: 460,
          color: "var(--np-color-muted-foreground, #94a3b8)",
          fontSize: "0.9375rem",
          lineHeight: 1.6,
        }}
      >
        {process.env.NODE_ENV === "production"
          ? "Refreshing usually clears this. If it doesn't, try again in a moment."
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
          href="/"
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
          Back home
        </a>
      </div>
    </div>
  );
}

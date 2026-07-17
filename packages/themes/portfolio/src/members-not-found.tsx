import * as React from "react";

/**
 * Portfolio member-tree 404.
 *
 * Mirrors `PortfolioNotFound`'s minimal voice but tuned for the
 * member context — CTA points at `/members/login` rather than
 * the homepage, and the copy acknowledges stale auth links (the
 * dominant cause of 404s inside `/members/*`).
 *
 * Server component; rendered by `(member)/not-found.tsx` when
 * the active theme is portfolio and `impl.members.notFound` is
 * declared.
 *
 * Renders a `<div>`, not `<main>`, because the framework's
 * `<ShellWrap surface="member">` already emits the page's
 * `<main className="np-member-main">` landmark.
 */
export function PortfolioMembersNotFound(): React.ReactElement {
  return (
    <div
      className="np-portfolio-members-not-found"
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
          color: "var(--np-color-muted-foreground)",
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
        }}
      >
        Link no longer valid.
      </h1>
      <p
        style={{
          margin: "1.25rem 0 0",
          color: "var(--np-color-muted-foreground)",
          fontSize: "0.9375rem",
          lineHeight: 1.6,
        }}
      >
        Verification and password-reset links are single-use and short-lived. Request a fresh one
        from the sign-in page.
      </p>
      <a
        href="/members/login"
        style={{
          display: "inline-block",
          marginTop: "2rem",
          padding: "0.625rem 1.5rem",
          borderRadius: "0.25rem",
          background: "var(--np-color-primary)",
          color: "var(--np-color-primary-foreground)",
          textDecoration: "none",
          fontSize: "0.875rem",
          fontWeight: 500,
          letterSpacing: "0.02em",
        }}
      >
        Go to sign in
      </a>
    </div>
  );
}

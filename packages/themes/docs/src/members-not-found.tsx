import * as React from "react";

/**
 * Docs theme's member-tree 404.
 *
 * Mirrors `DocsNotFound`'s technical voice but tuned for the
 * member context — CTA points at `/members/login` rather than
 * the docs index, and the copy acknowledges stale auth links
 * (the dominant cause of 404s inside `/members/*`).
 *
 * Server component; rendered by `(member)/not-found.tsx` when
 * the active theme is docs and `impl.members.notFound` is
 * declared.
 *
 * Renders a `<div>`, not `<main>`, because the framework's
 * `<ShellWrap surface="member">` already emits the page's
 * `<main className="np-member-main">` landmark.
 */
export function DocsMembersNotFound(): React.ReactElement {
  return (
    <div
      className="np-docs-members-not-found"
      style={{
        maxWidth: 520,
        margin: "5rem auto",
        padding: "0 1.5rem",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--np-color-muted-foreground)",
          fontFamily: "var(--np-font-mono, ui-monospace, monospace)",
        }}
      >
        404 · account
      </p>
      <h1
        style={{
          margin: "0.75rem 0 0",
          fontSize: "1.875rem",
          fontFamily: "var(--np-font-heading)",
          fontWeight: 600,
          lineHeight: 1.2,
        }}
      >
        That account link is no longer valid.
      </h1>
      <p
        style={{
          margin: "1.25rem 0 0",
          color: "var(--np-color-muted-foreground)",
          fontSize: "0.9375rem",
          lineHeight: 1.6,
        }}
      >
        Verification and password-reset links are single-use and expire after a
        short window. Open the sign-in page and request a fresh one.
      </p>
      <p style={{ margin: "1.75rem 0 0" }}>
        <a
          href="/members/login"
          style={{
            display: "inline-block",
            padding: "0.5rem 1.25rem",
            borderRadius: "0.375rem",
            background: "var(--np-color-primary)",
            color: "var(--np-color-primary-foreground)",
            textDecoration: "none",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          Go to sign in
        </a>
      </p>
    </div>
  );
}

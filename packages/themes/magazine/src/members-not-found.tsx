import * as React from "react";

/**
 * Phase M.ref — magazine member-tree 404.
 *
 * Mirrors `MagazineNotFound`'s editorial voice but tuned for the
 * member context — CTA points at `/members/login` rather than `/`,
 * and the headline acknowledges stale auth links (the most common
 * cause of 404s inside `/members/*`).
 *
 * Server component; rendered by `(member)/not-found.tsx` when
 * the active theme is magazine and `impl.members.notFound` is
 * declared.
 */
export function MagazineMembersNotFound(): React.ReactElement {
  // `<div>` rather than `<main>` because (member)/not-found.tsx
  // is rendered as the body of (member)/layout.tsx's
  // `<main className="np-member-main">` — emitting another
  // `<main>` here would nest semantic landmarks (HTML spec:
  // one `<main>` per page).
  return (
    <div
      className="np-magazine-members-not-found"
      style={{
        maxWidth: 560,
        margin: "5rem auto",
        padding: "0 1.5rem",
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.8125rem",
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          color: "var(--np-color-primary)",
          fontFamily: "var(--np-font-heading)",
        }}
      >
        — Subscriber desk —
      </p>
      <h1
        style={{
          margin: "1rem 0 0",
          fontSize: "clamp(2rem, 5vw, 3rem)",
          fontFamily: "var(--np-font-heading)",
        }}
      >
        That link has gone to print.
      </h1>
      <p
        style={{
          margin: "1.5rem 0 0",
          color: "var(--np-color-muted-foreground)",
          fontSize: "1.0625rem",
        }}
      >
        Verification and password-reset links expire after a single use or a
        short window. If you arrived here from an email, request a fresh link
        from the sign-in page.
      </p>
      <a
        href="/members/login"
        style={{
          display: "inline-block",
          marginTop: "2rem",
          padding: "0.5rem 1.5rem",
          borderRadius: "0.25rem",
          background: "var(--np-color-primary)",
          color: "var(--np-color-primary-foreground)",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        Go to sign in
      </a>
    </div>
  );
}

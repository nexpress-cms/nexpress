import * as React from "react";

/**
 * Phase F.9 — magazine 404 page.
 *
 * Editorial style — large display headline + dateline + return-
 * home link. Server component; rendered by `(site)/not-found.tsx`
 * when the active theme contributes notFound.
 */
export function MagazineNotFound(): React.ReactElement {
  // `<div>` — (site)/layout.tsx already emits the page's `<main>`.
  return (
    <div
      className="np-magazine-not-found"
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
        — 404 —
      </p>
      <h1
        style={{
          margin: "1rem 0 0",
          fontSize: "clamp(2rem, 5vw, 3rem)",
          fontFamily: "var(--np-font-heading)",
        }}
      >
        This story isn't in the archive.
      </h1>
      <p
        style={{
          margin: "1.5rem 0 0",
          color: "var(--np-color-muted-foreground)",
          fontSize: "1.0625rem",
        }}
      >
        The page you were looking for has been moved, retitled, or never made
        it to print. Try the homepage or search the archive.
      </p>
      <a
        href="/"
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
        Return to the homepage
      </a>
    </div>
  );
}

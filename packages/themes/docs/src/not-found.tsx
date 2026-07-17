import * as React from "react";

/**
 * Phase F.9-B — docs 404.
 *
 * Tighter / less editorial than magazine's; suggests search +
 * homepage as next steps.
 */
export function DocsNotFound(): React.ReactElement {
  // `<div>` — (site)/layout.tsx already emits the page's `<main>`.
  return (
    <div
      className="np-docs-not-found"
      style={{
        maxWidth: 560,
        margin: "5rem auto",
        padding: "0 1.5rem",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--np-color-muted-foreground)",
        }}
      >
        404 — Not found
      </p>
      <h1 style={{ margin: "0.75rem 0 0.5rem", fontSize: "1.75rem" }}>
        That page isn&apos;t in the docs.
      </h1>
      <p
        style={{
          margin: "0.75rem 0 1.5rem",
          color: "var(--np-color-muted-foreground)",
        }}
      >
        It may have been renamed or merged into another section. Try the search bar in the header,
        or head to the homepage.
      </p>
      <a
        href="/"
        style={{
          display: "inline-block",
          padding: "0.4rem 1rem",
          borderRadius: "0.375rem",
          background: "var(--np-color-primary)",
          color: "var(--np-color-primary-foreground)",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        Homepage
      </a>
    </div>
  );
}

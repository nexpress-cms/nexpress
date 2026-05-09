import * as React from "react";

/**
 * Phase F.9-C — portfolio 404.
 *
 * Dark, sparse — matches the theme's surface palette. A single
 * line of copy + return-home link, centered.
 */
export function PortfolioNotFound(): React.ReactElement {
  // `<div>` — (site)/layout.tsx already emits the page's `<main>`.
  return (
    <div
      className="np-portfolio-not-found"
      style={{
        minHeight: "60vh",
        maxWidth: 480,
        margin: "0 auto",
        padding: "6rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          color: "var(--np-color-muted-foreground)",
        }}
      >
        404
      </p>
      <h1
        style={{
          margin: "1rem 0 0",
          fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
          fontWeight: 500,
          letterSpacing: "-0.02em",
        }}
      >
        Project not found
      </h1>
      <p
        style={{
          margin: "1rem 0 2rem",
          color: "var(--np-color-muted-foreground)",
          fontSize: "0.9375rem",
        }}
      >
        The page you&apos;re looking for moved or doesn&apos;t exist.
      </p>
      <a
        href="/"
        style={{
          display: "inline-block",
          padding: "0.5rem 1.5rem",
          border: "1px solid var(--np-color-border)",
          borderRadius: "0.25rem",
          color: "var(--np-color-foreground)",
          textDecoration: "none",
          fontSize: "0.875rem",
        }}
      >
        See selected work →
      </a>
    </div>
  );
}

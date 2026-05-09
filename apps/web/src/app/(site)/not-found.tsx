import { getActiveThemeNotFound } from "@nexpress/core";
import type { ComponentType } from "react";

import { ensureFor } from "@/lib/init-core";

/**
 * Phase F.7 — public-site 404 page.
 *
 * Delegates to the active theme's `impl.notFound` component
 * when defined. Without a theme contribution, renders the
 * framework's plain default — sites can ship a polished 404
 * without writing this file themselves.
 *
 * Routes outside `(site)/*` (admin / api) keep Next's
 * built-in 404 surface.
 */
export default async function SiteNotFound() {
  await ensureFor("read");
  const NotFound = (await getActiveThemeNotFound()) as
    | ComponentType
    | null;
  if (NotFound) return <NotFound />;
  // `<div>` not `<main>` — (site)/layout.tsx already emits
  // `<main className="np-site-main">` as the page's single
  // landmark; nesting another <main> here would violate
  // "one main per page" (HTML spec) + break landmark navigation.
  return (
    <div
      className="np-not-found"
      style={{
        maxWidth: 480,
        margin: "6rem auto",
        padding: "0 1.5rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Page not found</h1>
      <p style={{ margin: "1rem 0 0", color: "#64748b" }}>
        The page you're looking for doesn't exist or has moved.
      </p>
    </div>
  );
}

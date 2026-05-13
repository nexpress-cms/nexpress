import { getActiveThemeNotFound } from "@nexpress/core";
import type { ComponentType } from "react";

import { ShellWrap } from "../../components/shell-wrap";
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
 *
 * After the v0.2 layout-shell refactor, the page wraps itself
 * in `<ShellWrap surface="site">` because the layout no longer
 * does — so the 404 keeps showing the active theme's chrome.
 * Theme `notFound` components emit their own markup and may
 * include a `<main>`, but `<ShellWrap>` always emits one too;
 * theme authors should render the body content as a non-`<main>`
 * element to avoid nested landmarks (the magazine reference
 * theme already does this).
 */
export default async function SiteNotFound() {
  await ensureFor("read");
  const NotFound = (await getActiveThemeNotFound()) as ComponentType | null;
  return (
    <ShellWrap surface="site">
      {NotFound ? (
        <NotFound />
      ) : (
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
            The page you&apos;re looking for doesn&apos;t exist or has moved.
          </p>
        </div>
      )}
    </ShellWrap>
  );
}

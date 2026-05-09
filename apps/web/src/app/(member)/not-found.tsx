import { getActiveThemeMembersNotFound } from "@nexpress/core";
import type { ComponentType } from "react";

import { ensureFor } from "@/lib/init-core";

/**
 * Phase M.3 — member-tree 404 page.
 *
 * Mirrors `(site)/not-found.tsx` for the `(member)/members/*`
 * subtree. Delegates to the active theme's
 * `impl.members.notFound` first, then falls back to
 * `impl.notFound` (top-level), then to the framework default
 * below.
 *
 * The member 404 ships with a "Sign in" CTA pointing back to
 * `/members/login` — most "page not found" hits inside
 * `/members/*` are stale auth links (expired verify token URLs,
 * old reset-password links, password emails opened twice). The
 * site's top-level 404 default is "go home" — wrong CTA for
 * member pages.
 */
export default async function MemberNotFound() {
  await ensureFor("read");
  const NotFound = (await getActiveThemeMembersNotFound()) as
    | ComponentType
    | null;
  if (NotFound) return <NotFound />;
  // `<div>` rather than `<main>` because (member)/layout.tsx
  // already emits a `<main className="np-member-main">` wrapping
  // this body — second `<main>` would nest semantic landmarks
  // (HTML spec: one `<main>` per page).
  return (
    <div
      className="np-not-found np-not-found-member"
      style={{
        maxWidth: 480,
        margin: "6rem auto",
        padding: "0 1.5rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Page not found</h1>
      <p style={{ margin: "1rem 0 0", color: "#64748b" }}>
        This member page doesn&rsquo;t exist or the link has expired.
      </p>
      <p style={{ margin: "1.5rem 0 0" }}>
        <a
          href="/members/login"
          style={{
            display: "inline-block",
            padding: "0.5rem 1.25rem",
            borderRadius: "0.375rem",
            border: "1px solid #cbd5e1",
            background: "white",
            color: "#0f172a",
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          Go to sign in
        </a>
      </p>
    </div>
  );
}

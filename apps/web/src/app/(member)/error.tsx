"use client";

import { lazy, Suspense, useState } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

/**
 * Phase M.3 — member-tree error boundary fallback.
 *
 * Same pattern as `(site)/error.tsx` (F.7.1 delegation): Next
 * mandates `error.tsx` is `"use client"`, so server-imported
 * `impl.members.error` references can't be transparently
 * delegated. Themes ship a SEPARATE client-only component at
 * a `./components/members-error` subpath; the registry below
 * lazy-imports the active theme's chunk based on the
 * `<style data-np-theme="<id>">` tag the layout already
 * emitted into the DOM by the time the boundary fires.
 *
 * Fallback chain at render time:
 *   1. theme has a member-error subpath in THEME_MEMBER_ERRORS
 *      → use that
 *   2. theme has a top-level error subpath (in `(site)/error.tsx`'s
 *      THEME_ERRORS map) — NOT inherited here; member surface
 *      keeps its own registry to avoid coupling the two trees'
 *      bundle splits
 *   3. framework default (DefaultMemberError below)
 *
 * Keeping the registry empty today: no theme ships a
 * `./components/members-error` subpath yet. Magazine reference
 * adoption lands in M.ref. Adding a theme: import the subpath
 * here and add a key to THEME_MEMBER_ERRORS.
 */

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const THEME_MEMBER_ERRORS: Record<
  string,
  LazyExoticComponent<ComponentType<ErrorPageProps>>
> = {
  magazine: lazy(
    () => import("@nexpress/theme-magazine/components/members-error"),
  ),
};

/** See `(site)/error.tsx` for the rationale on the lazy-init
 *  + DOM read pattern. The active-theme tag is shared between
 *  trees — the layout (whichever group fired) emits the same
 *  `data-np-theme` attribute. */
function useActiveThemeId(): string | null {
  const [themeId] = useState<string | null>(() => {
    if (typeof document === "undefined") return null;
    const styleTag = document.querySelector<HTMLStyleElement>(
      "style[data-np-theme]",
    );
    return styleTag?.dataset.npTheme ?? null;
  });
  return themeId;
}

export default function MemberError(props: ErrorPageProps) {
  const themeId = useActiveThemeId();
  const ThemeError = themeId ? THEME_MEMBER_ERRORS[themeId] : undefined;

  if (ThemeError) {
    return (
      <Suspense fallback={<DefaultMemberError {...props} />}>
        <ThemeError {...props} />
      </Suspense>
    );
  }
  return <DefaultMemberError {...props} />;
}

function DefaultMemberError({ error, reset }: ErrorPageProps) {
  // `<div>` rather than `<main>` because (member)/layout.tsx
  // already emits a `<main className="np-member-main">` wrapping
  // this body — second `<main>` would nest semantic landmarks.
  return (
    <div
      className="np-error np-error-member"
      style={{
        maxWidth: 480,
        margin: "6rem auto",
        padding: "0 1.5rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Something went wrong</h1>
      <p style={{ margin: "1rem 0 0", color: "#64748b" }}>
        {process.env.NODE_ENV === "production"
          ? "Please try again in a moment, or sign in again if the problem persists."
          : error.message}
      </p>
      <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", justifyContent: "center" }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "0.375rem",
            border: "1px solid #cbd5e1",
            background: "white",
            cursor: "pointer",
            fontSize: "0.875rem",
          }}
        >
          Try again
        </button>
        <a
          href="/members/login"
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: "0.375rem",
            border: "1px solid #cbd5e1",
            background: "white",
            color: "#0f172a",
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          Back to sign in
        </a>
      </div>
    </div>
  );
}

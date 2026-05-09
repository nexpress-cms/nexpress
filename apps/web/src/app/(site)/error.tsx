"use client";

import { lazy, Suspense, useState } from "react";

/**
 * Phase F.7 / F.7.1 — public-site error boundary fallback.
 *
 * **The Next constraint** (preserved from F.7): `error.tsx` MUST
 * be `"use client"`. A theme's `impl.error` is a server-imported
 * reference, so the framework can't transparently delegate from
 * here — the React server→client boundary blocks it.
 *
 * **F.7.1 workaround** — themes ship a *separate* client error
 * component at a `./components/error` subpath. The site's
 * error.tsx (this file) maintains a registry of theme-id →
 * `lazy(() => import(...))` so only the active theme's chunk
 * downloads when the boundary fires. Themes that don't ship a
 * subpath fall back to the framework default at the bottom of
 * this file.
 *
 * Active-theme detection: the (site) layout renders a
 * `<style data-np-theme="<id>">` tag for the theme's CSS, so the
 * theme id is already in the DOM by the time error.tsx mounts.
 * `useActiveThemeId` reads it without an extra cookie / network
 * round-trip.
 *
 * Adding a new theme: import its error subpath into the
 * `THEME_ERRORS` map below. Removing a theme: drop the entry.
 * The framework default keeps the file resilient when a theme
 * package is uninstalled but the registry entry is still in
 * source.
 */

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const THEME_ERRORS: Record<
  string,
  React.LazyExoticComponent<React.ComponentType<ErrorPageProps>>
> = {
  magazine: lazy(
    () => import("@nexpress/theme-magazine/components/error"),
  ),
};

/** Read the active theme id from the `<style data-np-theme>` tag
 *  emitted by the (site) layout.
 *
 *  Uses `useState`'s lazy initializer (function form) so the DOM
 *  read happens SYNCHRONOUSLY during the first render — this
 *  avoids the brief DefaultError flash that would otherwise
 *  appear before a `useEffect`-based read fires. error.tsx is
 *  Next-mandated `"use client"` so `document` is always available
 *  by the time the boundary's render runs. The `typeof document`
 *  guard is defensive against any future SSR pre-render of the
 *  client error component (Next currently doesn't do this for
 *  `error.tsx` but the contract may evolve).
 *
 *  Returns null on routes that never rendered the theme style
 *  (e.g. a layout error caught before the style went out — rare). */
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

export default function SiteError(props: ErrorPageProps) {
  const themeId = useActiveThemeId();
  const ThemeError = themeId ? THEME_ERRORS[themeId] : undefined;

  if (ThemeError) {
    return (
      <Suspense fallback={<DefaultError {...props} />}>
        <ThemeError {...props} />
      </Suspense>
    );
  }
  return <DefaultError {...props} />;
}

function DefaultError({ error, reset }: ErrorPageProps) {
  return (
    <main
      className="np-error"
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
          ? "Please try again in a moment."
          : error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: "1.5rem",
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
    </main>
  );
}

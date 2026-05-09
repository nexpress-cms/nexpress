"use client";

/**
 * Phase F.7.1 — magazine theme's error boundary fallback.
 *
 * Next requires `(site)/error.tsx` to be a client component, so
 * theme error UI ships as a separate client subpath that the
 * site's error.tsx lazy-imports based on the active theme. The
 * theme's main `impl.error` slot stays as a forward-compat type
 * marker; the actual rendering goes through this client entry.
 *
 * Imported as `@nexpress/theme-magazine/components/error` from a
 * client error.tsx like:
 *
 * ```tsx
 * "use client";
 * import { lazy, Suspense } from "react";
 *
 * const MagazineError = lazy(() =>
 *   import("@nexpress/theme-magazine/components/error"),
 * );
 *
 * export default function SiteError(props) {
 *   const themeId = useActiveThemeId();
 *   if (themeId === "magazine") {
 *     return (
 *       <Suspense fallback={null}>
 *         <MagazineError {...props} />
 *       </Suspense>
 *     );
 *   }
 *   return <DefaultError {...props} />;
 * }
 * ```
 */

interface MagazineErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function MagazineError({ error, reset }: MagazineErrorProps) {
  // `<div>` — (site)/layout.tsx already emits the page's `<main>`.
  return (
    <div
      className="np-magazine np-magazine-error"
      style={{
        maxWidth: 720,
        margin: "5rem auto",
        padding: "2rem 1.5rem",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: "var(--np-font-body, Georgia, serif)",
          fontSize: "0.7rem",
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "var(--np-color-muted-foreground, #64748b)",
          margin: "0 0 0.5rem",
        }}
      >
        Stop the press
      </p>
      <h1
        style={{
          fontFamily: "var(--np-font-heading, 'Fraunces', Georgia, serif)",
          fontSize: "clamp(2rem, 5vw, 3rem)",
          margin: 0,
          lineHeight: 1.1,
          borderTop: "3px double var(--np-color-foreground, #0f172a)",
          borderBottom: "1px solid var(--np-color-border, #e2e8f0)",
          padding: "1.5rem 0",
        }}
      >
        Something tore in the layout
      </h1>
      <p
        style={{
          margin: "1.5rem auto 0",
          maxWidth: 540,
          fontSize: "1rem",
          fontStyle: "italic",
          color: "var(--np-color-muted-foreground, #64748b)",
          lineHeight: 1.6,
        }}
      >
        {process.env.NODE_ENV === "production"
          ? "We've sent the typesetters back to the floor. Try again in a moment."
          : error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: "2rem",
          padding: "0.6rem 1.5rem",
          fontFamily: "inherit",
          fontSize: "0.85rem",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          background: "var(--np-color-primary, #0f172a)",
          color: "var(--np-color-primary-foreground, #fff)",
          border: "none",
          borderRadius: "0.25rem",
          cursor: "pointer",
        }}
      >
        Reload the page
      </button>
    </div>
  );
}

"use client";

/**
 * Phase F.7.1 — magazine theme's error boundary fallback.
 *
 * Next requires `(site)/error.tsx` to be a client component, so
 * theme error UI ships as a separate client subpath that the
 * site's error.tsx lazy-imports based on the active theme.
 */

interface MagazineErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function MagazineError({ error, reset }: MagazineErrorProps) {
  return (
    <main className="np-magazine np-magazine-error np-magazine-message">
      <p className="np-magazine-message-eyebrow">Stop the press</p>
      <h1 className="np-magazine-message-title">Something tore in the layout</h1>
      <p className="np-magazine-message-body">
        {process.env.NODE_ENV === "production"
          ? "We've sent the typesetters back to the floor. Try again in a moment."
          : error.message}
      </p>
      <div className="np-magazine-message-actions">
        <button type="button" onClick={reset} className="np-magazine-cta">
          Reload the page
        </button>
      </div>
    </main>
  );
}

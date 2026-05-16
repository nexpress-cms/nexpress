"use client";

/**
 * Phase M.ref — magazine theme's member-tree error boundary
 * fallback. Mirrors `./error.tsx` (F.7.1) but adds a "Back to
 * sign in" ghost CTA — the common cause of an error inside
 * `/members/*` is stale session state that a fresh sign-in
 * clears.
 */

interface MagazineMembersErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function MagazineMembersError({
  error,
  reset,
}: MagazineMembersErrorProps) {
  return (
    <main className="np-magazine np-magazine-members-error np-magazine-message">
      <p className="np-magazine-message-eyebrow">Subscriber desk</p>
      <h1 className="np-magazine-message-title">
        We lost the thread of your session.
      </h1>
      <p className="np-magazine-message-body">
        {process.env.NODE_ENV === "production"
          ? "A fresh sign-in usually clears this. Try again, or sign in to start over."
          : error.message}
      </p>
      <div className="np-magazine-message-actions">
        <button type="button" onClick={reset} className="np-magazine-cta">
          Try again
        </button>
        <a href="/members/login" className="np-magazine-cta np-magazine-cta-ghost">
          Back to sign in
        </a>
      </div>
    </main>
  );
}

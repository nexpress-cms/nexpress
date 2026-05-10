"use client";

/**
 * Phase M.ref — magazine theme's member-tree error boundary
 * fallback.
 *
 * Same delegation pattern as `./error.tsx` (F.7.1): Next requires
 * `(member)/error.tsx` to be a client component, so theme error
 * UI ships as a separate client subpath that the operator's
 * error.tsx lazy-imports based on the active theme. The theme's
 * `impl.members.error` slot stays as a forward-compat type
 * marker; the actual rendering goes through this client entry.
 *
 * Imported as `@nexpress/theme-magazine/components/members-error`
 * by `apps/web/src/app/(member)/error.tsx`.
 *
 * Tone differs from `./error.tsx`: member errors include a
 * "Back to sign in" link in addition to "Try again", because the
 * common cause of an error inside `/members/*` is stale session
 * state that a fresh sign-in clears.
 */

interface MagazineMembersErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function MagazineMembersError({
  error,
  reset,
}: MagazineMembersErrorProps) {
  // After the v0.2 layout-shell refactor, the host's
  // (member)/error.tsx renders its own `<main>` (the layout no
  // longer emits one). Theme members-error subpaths render in
  // place of DefaultMemberError, so we mirror its semantic
  // landmark — one `<main>` per page either way.
  return (
    <main
      className="np-magazine np-magazine-members-error"
      style={{
        maxWidth: 560,
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
        Subscriber desk
      </p>
      <h1
        style={{
          fontFamily: "var(--np-font-heading, 'Fraunces', Georgia, serif)",
          fontSize: "clamp(1.75rem, 4.5vw, 2.5rem)",
          margin: 0,
          lineHeight: 1.1,
          borderTop: "3px double var(--np-color-foreground, #0f172a)",
          borderBottom: "1px solid var(--np-color-border, #e2e8f0)",
          padding: "1.5rem 0",
        }}
      >
        We lost the thread of your session.
      </h1>
      <p
        style={{
          margin: "1.5rem auto 0",
          maxWidth: 480,
          fontSize: "1rem",
          fontStyle: "italic",
          color: "var(--np-color-muted-foreground, #64748b)",
          lineHeight: 1.6,
        }}
      >
        {process.env.NODE_ENV === "production"
          ? "A fresh sign-in usually clears this. Try again, or sign in to start over."
          : error.message}
      </p>
      <div
        style={{
          marginTop: "2rem",
          display: "flex",
          gap: "0.75rem",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={reset}
          style={{
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
          Try again
        </button>
        <a
          href="/members/login"
          style={{
            padding: "0.6rem 1.5rem",
            fontFamily: "inherit",
            fontSize: "0.85rem",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            background: "transparent",
            color: "var(--np-color-foreground, #0f172a)",
            border: "1px solid var(--np-color-border, #e2e8f0)",
            borderRadius: "0.25rem",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Back to sign in
        </a>
      </div>
    </main>
  );
}

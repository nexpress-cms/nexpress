"use client";

/**
 * Docs theme's member-tree error boundary fallback.
 *
 * Same delegation pattern as magazine's: Next requires
 * `(member)/error.tsx` to be a client component, so theme error
 * UI ships as a separate client subpath that the host's
 * error.tsx lazy-imports based on the active theme. The theme's
 * `impl.members.error` slot stays as a forward-compat type
 * marker; the actual rendering goes through this client entry.
 *
 * Imported as `@nexpress/theme-docs/components/members-error`
 * by `apps/web/src/app/(member)/error.tsx`.
 *
 * Tone matches the docs aesthetic — technical, monospace
 * accent, with "Back to sign in" as the secondary CTA.
 */

interface DocsMembersErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DocsMembersError({ error, reset }: DocsMembersErrorProps) {
  // Renders `<main>` because the host's (member)/error.tsx no
  // longer relies on the layout for the `<main>` landmark (v0.2
  // shell-wrap refactor moved that into pages). Theme
  // members-error subpaths render in place of DefaultMemberError,
  // so we mirror its `<main>` — one per page either way.
  return (
    <main
      className="np-docs np-docs-members-error"
      style={{
        maxWidth: 520,
        margin: "5rem auto",
        padding: "0 1.5rem",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--np-color-muted-foreground, #64748b)",
          fontFamily: "var(--np-font-mono, ui-monospace, monospace)",
        }}
      >
        500 · account
      </p>
      <h1
        style={{
          margin: "0.75rem 0 0",
          fontSize: "1.875rem",
          fontFamily: "var(--np-font-heading)",
          fontWeight: 600,
          lineHeight: 1.2,
        }}
      >
        Something interrupted your session.
      </h1>
      <p
        style={{
          margin: "1.25rem 0 0",
          color: "var(--np-color-muted-foreground, #64748b)",
          fontSize: "0.9375rem",
          lineHeight: 1.6,
        }}
      >
        {process.env.NODE_ENV === "production"
          ? "A fresh sign-in usually clears this. Try again, or sign back in to start fresh."
          : error.message}
      </p>
      <div
        style={{
          marginTop: "1.75rem",
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.5rem 1.25rem",
            fontFamily: "inherit",
            fontSize: "0.875rem",
            fontWeight: 500,
            background: "var(--np-color-primary, #0f172a)",
            color: "var(--np-color-primary-foreground, #fff)",
            border: "none",
            borderRadius: "0.375rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <a
          href="/members/login"
          style={{
            padding: "0.5rem 1.25rem",
            fontFamily: "inherit",
            fontSize: "0.875rem",
            fontWeight: 500,
            background: "transparent",
            color: "var(--np-color-foreground)",
            border: "1px solid var(--np-color-border, #e2e8f0)",
            borderRadius: "0.375rem",
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

import Link from "next/link";

/**
 * Admin route group 404. Without this file, any unmatched
 * `/admin/...` URL falls through to the public `(site)/not-found`
 * — which renders the active site theme's chrome around the
 * message, surprising the operator who's mentally inside the
 * admin context (different brand, dark mode, sidebar, etc.).
 *
 * Sits at `(admin)/not-found.tsx` (the group level, alongside
 * `(admin)/layout.tsx`) so it's reached even when the missing
 * URL is outside `(protected)/*` — that means it doesn't go
 * through the auth/AdminShell layout, which keeps the page
 * accessible to logged-out operators who hit a wrong link too.
 */
export default function AdminNotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "#0a0a0a",
        color: "#e5e5e5",
      }}
    >
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <p
          style={{
            fontSize: "0.75rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#737373",
            margin: 0,
          }}
        >
          Admin · 404
        </p>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 600,
            margin: "0.5rem 0 0",
            letterSpacing: "-0.02em",
          }}
        >
          That admin page doesn&apos;t exist.
        </h1>
        <p
          style={{
            margin: "0.75rem 0 1.5rem",
            color: "#a3a3a3",
            fontSize: "0.9375rem",
          }}
        >
          The URL might be mistyped, or the page was removed. Use the dashboard to navigate from a
          known anchor.
        </p>
        <Link
          href="/admin"
          style={{
            display: "inline-block",
            padding: "0.625rem 1.25rem",
            borderRadius: "0.5rem",
            background: "#fafafa",
            color: "#0a0a0a",
            textDecoration: "none",
            fontWeight: 500,
            fontSize: "0.875rem",
          }}
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}

/**
 * Phase 10.5 — JSON-LD embedding helper. Renders a
 * `<script type="application/ld+json">` element with the
 * stringified payload. The structured-data builders in core
 * produce plain objects; pages compose them and pass them here.
 *
 * Why `dangerouslySetInnerHTML`: React escapes the contents of
 * `<script>` tags by default, which corrupts the JSON-LD body.
 * The payload is server-built from typed shapes, so the
 * "dangerous" part is bounded — the only way bad bytes land
 * here is through the builder functions, which we control.
 *
 * Note: we don't escape `<` inside the JSON via `<` like
 * some libraries do, because Next.js renders the script tag
 * with the right Content-Type header for the JSON to be
 * inert HTML — a `<` inside JSON is a string literal, not
 * markup. If a future surface starts inlining user-supplied
 * HTML into structured data fields, swap to `JSON.stringify`
 * with the `<\\/` escape pattern.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

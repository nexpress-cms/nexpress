/**
 * `?next=` validation for member-auth pages. We can't trust user-
 * controlled redirect targets — reject anything that isn't a
 * clearly-intra-site relative path so an attacker can't craft
 * `?next=https://evil.example.com` (or `?next=//evil.example.com`,
 * which browsers treat as protocol-relative) and bounce the
 * member off-site after auth.
 *
 * Rules: must start with `/`, must NOT start with `//` or `/\` (the
 * latter is the same protocol-relative footgun under some browser
 * URL normalizers). Anything else collapses to `/` (the home page).
 */
export function safeNext(next: string | undefined | null): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

/**
 * Build the `?next=…` query suffix to forward across redirect-back
 * links (login → register, register → login, etc.). Returns the
 * empty string when `next` collapses to `/` so we don't pollute
 * URLs with `?next=%2F`.
 */
export function nextQuery(next: string | undefined | null): string {
  const safe = safeNext(next);
  if (safe === "/") return "";
  return `?next=${encodeURIComponent(safe)}`;
}

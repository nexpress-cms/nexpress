import type { NextRequest } from "next/server";

/**
 * Loose site-URL resolver. Returns `config.site.url` when the
 * operator has set it; falls back to `request.url` (which is
 * derived from the request `Host` header) otherwise.
 *
 * Suitable for **same-origin** redirects (OAuth callbacks,
 * post-login bounces) — the user's browser is going back to the
 * same host they sent the request to, so an attacker-controlled
 * `Host` header just bounces them back to the attacker's host
 * (no token leak, just a wasted round trip).
 *
 * NOT suitable for user-deliverable URLs the framework hands to
 * a transactional email — for those, use {@link siteUrlStrict}.
 */
export function siteUrlLenient(
  config: { site: { url?: string | null } },
  request: NextRequest,
): URL {
  return config.site.url ? new URL(config.site.url) : new URL(request.url);
}

/**
 * Strict site-URL resolver. Throws when `config.site.url` is
 * unset — never falls back to `request.url`.
 *
 * Use for **email-deliverable** URLs (password-reset links,
 * email-verify links). The lenient resolver lets unset
 * `SITE_URL` fall back to the request `Host` header. That
 * fallback is safe for same-origin redirects but unsafe for
 * email links: an attacker can spoof `Host: attacker.example`
 * on `POST /api/auth/forgot-password` and cause the framework
 * to mail a real password-reset token inside an
 * `https://attacker.example/...` URL. The victim clicks the
 * link from their inbox; the browser delivers the token to
 * the attacker; the attacker resets the password = full
 * account takeover.
 *
 * The strict resolver closes that path by refusing to build
 * the URL. Operators must set `SITE_URL` for password-reset /
 * email-verify flows to work — the boot-time check in
 * `verifyStartupSafety` (#597) already warns when it's unset.
 */
export function siteUrlStrict(config: { site: { url?: string | null } }): URL {
  if (!config.site.url) {
    throw new Error(
      "SITE_URL is unset — refusing to build a user-deliverable URL " +
        "from the request `Host` header. Set SITE_URL to your public " +
        "origin (e.g. https://example.com) so password-reset and " +
        "email-verify links resolve to the legitimate site.",
    );
  }
  return new URL(config.site.url);
}

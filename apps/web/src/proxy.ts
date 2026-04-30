import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { i18nConfig, isLocale } from "@/i18n.config";

function getSecurityHeaders(request: NextRequest): Record<string, string> {
  const isDev = process.env.NODE_ENV !== "production";
  const protocol = request.nextUrl.protocol === "https:" ? "wss:" : "ws:";

  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self'${isDev ? ` ${protocol}//${request.nextUrl.host}` : ""}`,
      "frame-ancestors 'none'",
    ].join("; "),
  };
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Routes the proxy's auto-CSRF check skips. Each entry is a
 * deliberate decision, not an oversight:
 *
 *   - Pre-auth flows (login / register / refresh / password
 *     reset / email verify): the user has no nx-csrf cookie
 *     yet, so a same-site CSRF check is meaningless. These
 *     routes have their own anti-replay (per-IP rate limit on
 *     /api/auth/*, single-use email tokens for reset / verify).
 *   - `/api/internal/*`: bearer-token auth via NX_SCHEDULER_TOKEN.
 *     No browser session involved.
 *   - `/api/plugins/<id>/<...>` for `<...>` other than the
 *     standard CRUD (`./route.ts`) and `actions/*`: the plugin
 *     proxy is for plugin-supplied endpoints (often webhooks
 *     with HMAC signatures), and plugins enforce their own
 *     authentication. The CRUD + actions endpoints are NOT in
 *     this list — they go through the standard CSRF check.
 *   - `/api/openapi.json`: read-only, but listed for clarity.
 */
const CSRF_EXEMPT_PATTERNS: readonly RegExp[] = [
  /^\/api\/auth\/(login|logout|register|forgot-password|reset-password|verify|refresh)$/,
  /^\/api\/members\/(login|logout|register|forgot-password|reset-password|verify|refresh)$/,
  /^\/api\/internal\//,
  // plugins/<id>/<segment>/... where <segment> != "actions" — the
  // catch-all proxy. plugins/<id> (CRUD) and plugins/<id>/actions/<id>
  // both require CSRF and don't match this pattern.
  /^\/api\/plugins\/[^/]+\/(?!actions(\/|$))/,
];

function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATTERNS.some((p) => p.test(pathname));
}

const RATE_LIMITS: Array<{ pattern: RegExp; limit: number; windowMs: number }> = [
  { pattern: /^\/api\/auth\//, limit: 10, windowMs: 60_000 },
  { pattern: /^\/api\/media\/upload/, limit: 20, windowMs: 60_000 },
  { pattern: /^\/api\/import/, limit: 5, windowMs: 60_000 },
  { pattern: /^\/api\/collections\//, limit: 100, windowMs: 60_000 },
  { pattern: /^\/api\/plugins(?:\/|$)/, limit: 60, windowMs: 60_000 },
  { pattern: /^\/api\/users(?:\/|$)/, limit: 30, windowMs: 60_000 },
  { pattern: /^\/api\/search(?:\/|$)/, limit: 60, windowMs: 60_000 },
  // Member-side report submissions — keep tight to discourage report-spam.
  { pattern: /^\/api\/reports(?:\/|$)/, limit: 10, windowMs: 60_000 },
  // Phase 20.1 — job actions that do real work or bulk fan-out get
  // tighter limits than the general /api/admin/ bucket. Each
  // retry-all call fires up to 200 retries; enqueue runs an
  // arbitrary registered handler. List these ABOVE the general
  // rule below — first-match wins in checkRateLimit.
  { pattern: /^\/api\/admin\/jobs\/retry-all/, limit: 5, windowMs: 60_000 },
  { pattern: /^\/api\/admin\/jobs\/enqueue/, limit: 10, windowMs: 60_000 },
  { pattern: /^\/api\/admin\/jobs\/[^/]+\/retry/, limit: 30, windowMs: 60_000 },
  // Staff moderation surface (queue browsing, action buttons in admin).
  { pattern: /^\/api\/admin\//, limit: 60, windowMs: 60_000 },
  // Bearer-token-protected cron triggers. Rate-limit on top of the token so
  // a leaked token can't be used to DoS the DB (e.g. reindex in a loop).
  { pattern: /^\/api\/internal\//, limit: 10, windowMs: 60_000 },
];

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string, path: string): { limited: boolean; retryAfter?: number } {
  const rule = RATE_LIMITS.find((r) => r.pattern.test(path));
  if (!rule) return { limited: false };

  const key = `${ip}:${rule.pattern.source}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { limited: false };
  }

  entry.count++;
  if (entry.count > rule.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { limited: true, retryAfter };
  }

  return { limited: false };
}

// Guard against HMR re-evaluating this module: each reload would
// otherwise spawn a fresh interval and leak the previous one. The
// production runtime evaluates the module once, so the guard is
// only load-bearing in dev.
declare global {
  var __nx_rate_limit_cleanup_started: boolean | undefined;
}

if (!globalThis.__nx_rate_limit_cleanup_started) {
  globalThis.__nx_rate_limit_cleanup_started = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) {
        rateLimitStore.delete(key);
      }
    }
  }, 60_000);
}

/**
 * Phase 12.2 — pull the requested locale out of the URL path.
 *
 * `/ko/about` → "ko" + "/about"
 * `/about`    → defaultLocale + "/about"
 *
 * Admin / API / static asset paths skip i18n entirely (they're
 * locale-agnostic) so site visitors hitting `/admin` don't get
 * unnecessary cookie reads or redirects.
 */
function resolveSiteLocale(pathname: string): {
  locale: string;
  rewrite: string | null;
} {
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/_next/") ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt" ||
    pathname === "/feed.xml"
  ) {
    return { locale: i18nConfig.defaultLocale, rewrite: null };
  }
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (first && isLocale(first)) {
    return { locale: first, rewrite: null };
  }
  return { locale: i18nConfig.defaultLocale, rewrite: null };
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const securityHeaders = getSecurityHeaders(request);

  if (pathname.startsWith("/api/")) {
    const ip = getClientIp(request);
    const { limited, retryAfter } = checkRateLimit(ip, pathname);

    if (limited) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" }, status: 429 },
        {
          status: 429,
          headers: {
            ...securityHeaders,
            "Retry-After": String(retryAfter),
          },
        },
      );
    }

    // #281 — auto-CSRF for /api/* mutations. Until this guard
    // landed, every state-changing handler had to remember to
    // call `requireCsrf(request)`; a missed line passed code
    // review and tests silently and shipped without the check.
    // The list of exempt patterns is deliberately small and
    // explicit — pre-auth flows that have no nx-csrf cookie
    // yet, scheduler-token-authenticated internals, and the
    // plugin proxy where plugins handle their own auth.
    // Per-handler `requireCsrf` calls remain in place as
    // defense in depth; removing them is a follow-up.
    if (!CSRF_SAFE_METHODS.has(request.method) && !isCsrfExempt(pathname)) {
      const headerToken = request.headers.get("x-csrf-token");
      const staffCookie = request.cookies.get("nx-csrf")?.value;
      const memberCookie = request.cookies.get("nx-mb-csrf")?.value;
      // Either staff or member CSRF cookie can satisfy the check —
      // proxy doesn't know which lane the request is on, and the
      // per-handler auth still enforces the right session shape.
      // Header must be non-empty; a `undefined === undefined` slip
      // would let cookieless requests pass.
      const ok = Boolean(
        headerToken &&
          ((staffCookie && staffCookie === headerToken) ||
            (memberCookie && memberCookie === headerToken)),
      );
      if (!ok) {
        return NextResponse.json(
          { error: { code: "CSRF_INVALID", message: "Invalid CSRF token" }, status: 403 },
          { status: 403, headers: securityHeaders },
        );
      }
    }
  }

  // Phase 12.2 — propagate the resolved locale to server
  // components via a request header. Server components can read
  // it via `headers().get("x-nx-locale")` without re-parsing the
  // pathname themselves.
  const { locale } = resolveSiteLocale(pathname);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nx-locale", locale);
  requestHeaders.set("x-nx-pathname", pathname);

  // Phase 15.1 — propagate the request host so the server-side
  // site resolver can map it to a site id. The DB lookup
  // happens lazily in the resolver (cached per request); the
  // middleware just forwards the raw value.
  const host = request.headers.get("host") ?? request.headers.get("x-forwarded-host");
  if (host) {
    requestHeaders.set("x-nx-host", host);
  }

  // Phase 15.6 — admin context override. The site-picker UI
  // sets this cookie when an admin (typically a super-admin)
  // chooses which tenant to operate on. The bootstrap's
  // resolver reads `x-nx-admin-site` BEFORE x-nx-host, so the
  // cookie wins inside the admin area; the public site is
  // unaffected (the resolver only checks the override on
  // /admin and /api/admin paths). Validation that the user is
  // ALLOWED to operate on this site happens at the resolver
  // layer in core, not here — the middleware just forwards.
  const adminSite = request.cookies.get("nx-admin-site")?.value;
  if (adminSite && (pathname.startsWith("/admin") || pathname.startsWith("/api/admin"))) {
    requestHeaders.set("x-nx-admin-site", adminSite);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  // Phase 14.2 — cache + vary annotations.
  // - /admin and /api/admin: hard no-store so a misconfigured
  //   reverse proxy can't accidentally cache an admin's
  //   dashboard / API response and serve it to another user.
  // - /api/auth, /api/members, /api/identities: same — they
  //   carry session-derived data.
  // - Public site: Vary on Cookie + Accept-Language so a CDN
  //   doesn't cache a logged-in user's page and serve it to
  //   an anonymous visitor (or vice versa). Routes that opt
  //   into ISR set their own Cache-Control which overrides
  //   this default.
  const isPrivateRoute =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/members") ||
    pathname.startsWith("/api/identities") ||
    pathname.startsWith("/api/users");
  if (isPrivateRoute) {
    response.headers.set("Cache-Control", "private, no-store, must-revalidate");
  } else if (!pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    // Public site routes — let the per-route Cache-Control
    // (set by sitemap.xml / feed.xml / etc.) win when present;
    // otherwise just declare what the response varies on.
    const existingVary = response.headers.get("Vary");
    const varyDirectives = new Set(
      (existingVary ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    varyDirectives.add("Cookie");
    varyDirectives.add("Accept-Language");
    response.headers.set("Vary", [...varyDirectives].join(", "));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

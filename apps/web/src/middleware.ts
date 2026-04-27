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

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000);

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

export function middleware(request: NextRequest) {
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
  }

  // Phase 12.2 — propagate the resolved locale to server
  // components via a request header. Server components can read
  // it via `headers().get("x-nx-locale")` without re-parsing the
  // pathname themselves.
  const { locale } = resolveSiteLocale(pathname);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nx-locale", locale);
  requestHeaders.set("x-nx-pathname", pathname);

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
  } else if (
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/")
  ) {
    // Public site routes — let the per-route Cache-Control
    // (set by sitemap.xml / feed.xml / etc.) win when present;
    // otherwise just declare what the response varies on.
    const existingVary = response.headers.get("Vary");
    const varyDirectives = new Set(
      (existingVary ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    );
    varyDirectives.add("Cookie");
    varyDirectives.add("Accept-Language");
    response.headers.set("Vary", [...varyDirectives].join(", "));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

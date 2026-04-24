import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

  const response = NextResponse.next();

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

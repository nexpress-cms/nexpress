"use client";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;

  const cookies = document.cookie.split(";");

  for (const raw of cookies) {
    const [rawKey, ...rest] = raw.trim().split("=");

    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return undefined;
}

type MutatingMethod = "POST" | "PUT" | "PATCH" | "DELETE";

const MUTATING_METHODS = new Set<MutatingMethod>(["POST", "PUT", "PATCH", "DELETE"]);

function isMutating(method: string | undefined): method is MutatingMethod {
  if (!method) return false;
  return MUTATING_METHODS.has(method.toUpperCase() as MutatingMethod);
}

/**
 * `fetch` wrapper for admin UI calls. Adds the `X-CSRF-Token` header on
 * mutating requests by copying the `np-csrf` cookie that the auth flow set.
 * Returns the raw Response — callers handle parsing.
 */
export function npFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const method = init?.method ?? "GET";

  if (isMutating(method) && !headers.has("X-CSRF-Token")) {
    const token = readCookie("np-csrf");

    if (token) {
      headers.set("X-CSRF-Token", token);
    }
  }

  return fetch(input, { ...init, headers, credentials: "same-origin" });
}

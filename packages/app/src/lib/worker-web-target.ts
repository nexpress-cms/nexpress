export const WORKER_WEB_PROTOCOL_HEADER = "x-np-worker-web";
export const WORKER_WEB_PROTOCOL_VERSION = "1";

export function resolveWorkerWebEndpoint(env: Record<string, string | undefined>): URL | null {
  const configured = env.NP_WORKER_WEB_URL || env.SITE_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    ) {
      return new URL("/api/internal/revalidate-collection", url);
    }
  } catch {
    // A malformed origin cannot receive the scheduler token.
  }
  return null;
}

export function requestWorkerWeb(
  endpoint: URL,
  token: string,
  request: { method: "HEAD" } | { method: "POST"; body: string },
): Promise<Response> {
  return fetch(endpoint, {
    ...request,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(request.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

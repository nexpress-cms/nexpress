import {
  getOptionalAgentStudioServerRuntimeV1,
  type NpAgentOauthServiceV1,
} from "@nexpress/core/agents";

export async function getAgentOauthSurface(siteId: string): Promise<{
  oauth: NpAgentOauthServiceV1;
  origin: string;
  resource: string;
} | null> {
  const oauth = getOptionalAgentStudioServerRuntimeV1()?.oauth;
  if (!oauth) return null;
  try {
    const resource = await oauth.resourceFor(siteId);
    return { oauth, origin: new URL(resource).origin, resource };
  } catch {
    return null;
  }
}

export function agentOauthNotFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}

export function agentOauthBearerChallenge(origin: string, error?: "invalid_token"): string {
  const metadata = `${origin}/.well-known/oauth-protected-resource/api/mcp`;
  return `Bearer${error ? ` error="${error}",` : ""} resource_metadata="${metadata}"`;
}

export async function readExactOauthForm(
  request: Request,
  allowed: readonly string[],
  required: readonly string[],
): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new Error("invalid_request");
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^(0|[1-9][0-9]*)$/u.test(contentLength) || Number(contentLength) > 16_384)
  ) {
    throw new Error("invalid_request");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 16_384) {
          await reader.cancel();
          throw new Error("invalid_request");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("invalid_request");
  }
  const params = new URLSearchParams(body);
  const keys = [...new Set(params.keys())];
  if (
    keys.some((key) => !allowed.includes(key)) ||
    keys.some((key) => params.getAll(key).length !== 1) ||
    required.some((key) => params.getAll(key).length !== 1)
  ) {
    throw new Error("invalid_request");
  }
  return Object.fromEntries(keys.map((key) => [key, params.get(key)!]));
}

export function oauthJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", pragma: "no-cache" },
  });
}

export function oauthError(error: unknown): Response {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^[a-z_]{3,64}$/u.test((error as { code: string }).code)
      ? (error as { code: string }).code
      : error instanceof Error && /^[a-z_]{3,64}$/u.test(error.message)
        ? error.message
        : "invalid_request";
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    Number.isInteger((error as { status?: unknown }).status)
      ? (error as { status: number }).status
      : 400;
  return oauthJson({ error: code }, status);
}

import {
  DEFAULT_AUTH_MESSAGES,
  type NpAuthErrorCode,
} from "../../shared/types.js";

/**
 * Result of a typed JSON POST to one of the auth routes. Either
 * the route returned 2xx with a parsed payload, or it threw and
 * we mapped the response to a stable error code + message.
 */
export type SubmitResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: NpAuthErrorCode; message: string; fields?: Record<string, string> };

/**
 * Map server-side error shape (from `npErrorResponse`) onto our
 * stable client-facing code enum. The server uses string codes
 * from `NpErrorCode`; we narrow them here so hooks have a small,
 * predictable surface.
 */
function mapErrorCode(serverCode: string | undefined, status: number): NpAuthErrorCode {
  if (status === 0) return "NETWORK";
  if (serverCode === "FORBIDDEN") return "REGISTRATION_DISABLED";
  if (serverCode === "VALIDATION") return "VALIDATION";
  if (serverCode === "AUTH") return "INVALID_CREDENTIALS";
  if (serverCode === "RATE_LIMIT") return "RATE_LIMITED";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 410) return "TOKEN_EXPIRED";
  if (status === 400) return "VALIDATION";
  if (status >= 500) return "SERVER_ERROR";
  return "SERVER_ERROR";
}

/**
 * Extract per-field validation messages from the server response.
 * `npErrorResponse` for `NpValidationError` puts these on
 * `error.details: [{ field, message }]`.
 */
function extractFieldErrors(payload: unknown): Record<string, string> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return undefined;
  const out: Record<string, string> = {};
  for (const entry of details) {
    if (!entry || typeof entry !== "object") continue;
    const field = (entry as { field?: unknown }).field;
    const message = (entry as { message?: unknown }).message;
    if (typeof field === "string" && typeof message === "string") {
      out[field] = message;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * POSTs a JSON body to an auth route and normalizes the response
 * to `SubmitResult<T>`. All hooks share this — none of them need
 * different request semantics, and centralizing the error
 * mapping means every hook reports the same code for the same
 * server condition.
 */
export async function submitJson<T>(
  endpoint: string,
  body: unknown,
  messages: Record<NpAuthErrorCode, string>,
): Promise<SubmitResult<T>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, code: "NETWORK", message: messages.NETWORK };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response — keep going with status-only mapping.
  }

  if (!response.ok) {
    const serverCode =
      payload && typeof payload === "object"
        ? (payload as { error?: { code?: unknown } }).error?.code
        : undefined;
    const code = mapErrorCode(typeof serverCode === "string" ? serverCode : undefined, response.status);
    return {
      ok: false,
      code,
      message: messages[code] ?? messages.SERVER_ERROR,
      fields: extractFieldErrors(payload),
    };
  }

  return { ok: true, data: (payload ?? {}) as T };
}

/**
 * Combine caller's partial `messages` override with the defaults.
 */
export function resolveMessages(
  override?: Partial<Record<NpAuthErrorCode, string>>,
): Record<NpAuthErrorCode, string> {
  if (!override) return DEFAULT_AUTH_MESSAGES;
  return { ...DEFAULT_AUTH_MESSAGES, ...override };
}

import { Buffer } from "node:buffer";

/**
 * Phase 21.5 — fetch a media file from a WP source URL.
 *
 * The function is intentionally narrow:
 *
 *   - It only HTTP(S) GETs the URL the WXR pointed at; we don't
 *     follow `srcset` or guess `-scaled` variants. WP often has
 *     half a dozen size variants per image and re-deriving them
 *     after upload is cheaper (Sharp pipeline runs server-side
 *     anyway) than mirroring whatever the source happened to
 *     pre-render.
 *   - MIME is sniffed from the response `Content-Type` header,
 *     falling back to `application/octet-stream` if absent.
 *     The pipeline rejects anything not in the allow-list so a
 *     server returning text/html (404 page, redirect intercept,
 *     etc.) doesn't leak through.
 *   - One retry on network/timeout failure. 4xx is terminal
 *     (matches the design doc §6 — 404 is treated as a hard skip).
 */

export interface DownloadResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface DownloadOptions {
  /** Override `globalThis.fetch` — used by tests. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** How many times to retry network/timeout failures before giving up. */
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;

export class WpMediaDownloadError extends Error {
  readonly url: string;
  readonly status: number | null;
  constructor(url: string, message: string, status: number | null = null) {
    super(message);
    this.name = "WpMediaDownloadError";
    this.url = url;
    this.status = status;
  }
}

export async function downloadMedia(url: string, opts: DownloadOptions = {}): Promise<DownloadResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new WpMediaDownloadError(url, "no fetch implementation available");
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.retries ?? DEFAULT_RETRIES;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      // 4xx is terminal — design §6 treats 404 as skip-and-continue.
      // We let the caller distinguish "missing" from "transient" by
      // looking at `status`.
      if (!res.ok) {
        throw new WpMediaDownloadError(
          url,
          `source responded ${res.status} ${res.statusText || ""}`.trim(),
          res.status,
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = parseMime(res.headers.get("content-type"));
      const filename = inferFilename(url);
      return { buffer, mimeType, filename };
    } catch (err) {
      lastError = err;
      // 4xx errors aren't worth retrying.
      if (err instanceof WpMediaDownloadError && err.status !== null && err.status >= 400 && err.status < 500) {
        throw err;
      }
      if (attempt >= maxRetries) {
        if (err instanceof WpMediaDownloadError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new WpMediaDownloadError(url, msg);
      }
      // fall through and retry
    } finally {
      clearTimeout(timer);
    }
  }
  // unreachable — the loop either returns or throws.
  throw lastError instanceof Error ? lastError : new WpMediaDownloadError(url, "download failed");
}

function parseMime(header: string | null): string {
  if (!header) return "application/octet-stream";
  const semi = header.indexOf(";");
  return (semi >= 0 ? header.slice(0, semi) : header).trim().toLowerCase();
}

function inferFilename(url: string): string {
  // Strip query + fragment, then take the last path segment.
  // WP uploads frequently include a cache-busting query string.
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return decodeURIComponent(last);
  } catch {
    // fall through to fallback
  }
  return "download";
}

/**
 * The framework's upload routes accept image/*, video/*, and
 * application/pdf. Mirror that here so the importer doesn't push
 * anything through that the upload route would reject.
 */
export function isAllowedMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType === "application/pdf"
  );
}

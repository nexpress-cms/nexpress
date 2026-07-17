import { Buffer } from "node:buffer";
import { promises as dnsPromises } from "node:dns";
import { Agent } from "undici";

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
 *
 * SSRF guard (#270, #382):
 *
 *   - Scheme is restricted to http(s).
 *   - The hostname is resolved via DNS and every returned address
 *     is checked against private / loopback / link-local / CGNAT
 *     / multicast / reserved CIDRs. Any private result rejects
 *     the URL — we don't fall through to the public IPs because
 *     a malicious DNS response can rebind between the check and
 *     the fetch (TOCTOU). For the importer's purposes, hosting
 *     media on a hostname that *also* has a private A record is
 *     vanishingly rare; rejecting it is the safer default.
 *   - The vetted address is then *pinned* on an undici `Agent` so
 *     `fetch` connects to that exact IP instead of re-resolving
 *     the hostname (#382). Without pinning, the preflight DNS
 *     check and the connect-time DNS resolution are independent,
 *     leaving a DNS-rebinding window where a public answer passes
 *     the check and a private answer is what gets connected. SNI /
 *     Host headers stay set to the original hostname so HTTPS cert
 *     validation still works.
 *   - Redirects are followed manually (`redirect: "manual"`),
 *     capped at 3 hops, and each hop re-runs the DNS / private-IP
 *     check AND re-pins the connect address. The platform `fetch`
 *     would otherwise silently follow a public-IP 302 to
 *     `169.254.169.254`.
 *   - `Content-Length` is checked against `maxBytes` *before* the
 *     body is read so a slow-read attacker can't tie the worker up
 *     past the timeout window.
 *
 *   The `allowPrivateHosts` option exists for tests and for
 *   self-hosted deployments where the WXR is genuinely on the
 *   same private network as the importer.
 */

export interface DownloadResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface DownloadOptions {
  /** Override `globalThis.fetch` — used by tests. */
  fetchImpl?: typeof fetch;
  /** Override DNS lookup — used by tests to drive private-IP rejection. */
  dnsLookupImpl?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** How many times to retry network/timeout failures before giving up. */
  retries?: number;
  /** Maximum redirect hops. Default 3. Each hop re-validates the host. */
  maxRedirects?: number;
  /** Maximum response size in bytes. Default 100 MiB. */
  maxBytes?: number;
  /**
   * Skip the private-IP check. ONLY for tests and self-hosted
   * deployments where the source server lives on the same
   * private network as the importer.
   */
  allowPrivateHosts?: boolean;
}

type FetchInitWithDispatcher = Omit<RequestInit, "dispatcher"> & {
  dispatcher?: unknown;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

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

/**
 * Thrown when the URL or any redirect target resolves to a host we
 * refuse to talk to (private IP, loopback, non-HTTP scheme, etc).
 * A separate subclass so `downloadMedia`'s retry loop can recognise
 * it and refuse to retry — re-resolving DNS won't make a `127.0.0.1`
 * AAAA record any safer.
 */
export class WpMediaSsrfError extends WpMediaDownloadError {
  constructor(url: string, message: string) {
    super(url, message);
    this.name = "WpMediaSsrfError";
  }
}

export async function downloadMedia(
  url: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new WpMediaDownloadError(url, "no fetch implementation available");
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.retries ?? DEFAULT_RETRIES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // Validate the entry-point scheme up front so a bad URL fails
  // before we burn a retry attempt on it.
  assertHttpScheme(url);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchWithRedirects(url, {
        fetchImpl,
        dnsLookupImpl: opts.dnsLookupImpl,
        signal: controller.signal,
        maxRedirects,
        maxBytes,
        allowPrivateHosts: opts.allowPrivateHosts ?? false,
      });
    } catch (err) {
      lastError = err;
      // SSRF / scheme rejections are deterministic — retrying
      // won't change the answer.
      if (err instanceof WpMediaSsrfError) throw err;
      // 4xx errors aren't worth retrying.
      if (
        err instanceof WpMediaDownloadError &&
        err.status !== null &&
        err.status >= 400 &&
        err.status < 500
      ) {
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

interface FetchWithRedirectsOpts {
  fetchImpl: typeof fetch;
  dnsLookupImpl?: DownloadOptions["dnsLookupImpl"];
  signal: AbortSignal;
  maxRedirects: number;
  maxBytes: number;
  allowPrivateHosts: boolean;
}

async function fetchWithRedirects(
  originalUrl: string,
  opts: FetchWithRedirectsOpts,
): Promise<DownloadResult> {
  let currentUrl = originalUrl;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    let pinned: PinnedAddress | null = null;
    if (!opts.allowPrivateHosts) {
      pinned = await assertHostAllowed(currentUrl, opts.dnsLookupImpl);
    }
    // Pin the connect-time address to the vetted IP so the host's
    // DNS can't rebind between the check above and the network
    // call below (#382). When `allowPrivateHosts` is set we skip
    // the agent entirely — the preflight check itself is bypassed,
    // so pinning would have nothing to enforce.
    const dispatcher = pinned ? createPinnedAgent(pinned) : undefined;
    // Node's bundled fetch is undici under the hood and accepts a
    // `dispatcher` option. Keep the property as `unknown` so the
    // call site does not couple ambient fetch types to our explicit
    // undici dependency version.
    const init: FetchInitWithDispatcher = {
      signal: opts.signal,
      redirect: "manual",
    };
    if (dispatcher) {
      init.dispatcher = dispatcher;
    }
    const res = await opts.fetchImpl(currentUrl, init as RequestInit);
    if (isRedirectStatus(res.status)) {
      const next = res.headers.get("location");
      if (!next) {
        throw new WpMediaDownloadError(
          currentUrl,
          `redirect ${res.status} without Location header`,
          res.status,
        );
      }
      // `new URL(next, currentUrl)` resolves relative redirects
      // against the prior hop, matching browser semantics.
      currentUrl = new URL(next, currentUrl).toString();
      assertHttpScheme(currentUrl);
      continue;
    }
    if (!res.ok) {
      throw new WpMediaDownloadError(
        currentUrl,
        `source responded ${res.status} ${res.statusText || ""}`.trim(),
        res.status,
      );
    }
    const declaredLength = res.headers.get("content-length");
    if (declaredLength !== null) {
      const n = Number(declaredLength);
      if (Number.isFinite(n) && n > opts.maxBytes) {
        throw new WpMediaDownloadError(
          currentUrl,
          `content-length ${n} exceeds maxBytes ${opts.maxBytes}`,
        );
      }
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > opts.maxBytes) {
      throw new WpMediaDownloadError(
        currentUrl,
        `body ${arrayBuffer.byteLength} bytes exceeds maxBytes ${opts.maxBytes}`,
      );
    }
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = parseMime(res.headers.get("content-type"));
    // Filename is derived from the URL the WXR pointed at — not the
    // final hop. CDNs frequently rewrite paths in ways that lose the
    // original basename ("a1b2c3.cdn.com/asset?id=42").
    const filename = inferFilename(originalUrl);
    return { buffer, mimeType, filename };
  }
  throw new WpMediaDownloadError(currentUrl, `too many redirects (max ${opts.maxRedirects})`);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function assertHttpScheme(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WpMediaSsrfError(url, `invalid URL "${url}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WpMediaSsrfError(
      url,
      `unsupported scheme "${parsed.protocol}" — only http(s) is allowed`,
    );
  }
}

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

async function assertHostAllowed(
  url: string,
  dnsLookupImpl?: DownloadOptions["dnsLookupImpl"],
): Promise<PinnedAddress> {
  const parsed = new URL(url);
  // WHATWG URL keeps the brackets on `.hostname` for IPv6 literals
  // (`http://[::1]/` → `[::1]`). Strip them before any classification
  // or DNS lookup so the IPv6 detection branch matches.
  const rawHostname = parsed.hostname;
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;

  // Reject obvious sentinels before bothering with DNS.
  const lowered = hostname.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".localhost")) {
    throw new WpMediaSsrfError(url, `hostname "${hostname}" resolves to a private address`);
  }

  // If the URL host is itself an IP literal, check it directly.
  const literal = classifyIpLiteral(hostname);
  if (literal === "private") {
    throw new WpMediaSsrfError(url, `hostname "${hostname}" resolves to a private address`);
  }
  if (literal === "public") {
    // Already a routable public IP — pin it so the connect step
    // can't dodge the check via a different resolution path.
    return { address: hostname, family: hostname.includes(":") ? 6 : 4 };
  }

  // Hostname → DNS lookup.
  const lookup = dnsLookupImpl ?? defaultDnsLookup;
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(hostname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WpMediaSsrfError(url, `DNS lookup failed for "${hostname}": ${msg}`);
  }
  if (addrs.length === 0) {
    throw new WpMediaSsrfError(url, `DNS returned no addresses for "${hostname}"`);
  }
  let pinned: PinnedAddress | null = null;
  for (const { address, family } of addrs) {
    const cls = classifyIpAddress(address, family);
    if (cls === "private") {
      throw new WpMediaSsrfError(
        url,
        `hostname "${hostname}" resolves to private address ${address}`,
      );
    }
    // First public address wins as the pinned target. Any later
    // private result still rejects the whole URL — we're not
    // willing to talk to a hostname that fans out to internal IPs.
    if (!pinned && (family === 4 || family === 6)) {
      pinned = { address, family };
    }
  }
  if (!pinned) {
    throw new WpMediaSsrfError(url, `DNS returned no usable addresses for "${hostname}"`);
  }
  return pinned;
}

/**
 * Build an undici Agent whose connect-time hostname lookup always
 * returns the already-vetted address. The Host header / SNI stay
 * set to the original hostname (undici uses `req.host` for those,
 * not the connect target) so HTTPS cert validation works.
 */
function createPinnedAgent(pinned: PinnedAddress): Agent {
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        _options: unknown,
        callback: (err: Error | null, address: string, family: number) => void,
      ) => {
        callback(null, pinned.address, pinned.family);
      },
    },
  });
}

async function defaultDnsLookup(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  // `all: true` returns every A/AAAA record so a multi-homed
  // hostname with a public A and a private AAAA (or vice versa)
  // gets caught by the loop above.
  return dnsPromises.lookup(hostname, { all: true });
}

/**
 * Classify a string that *might* already be an IP address.
 * Returns "private" / "public" / "not-an-ip".
 */
function classifyIpLiteral(input: string): "private" | "public" | "not-an-ip" {
  if (looksLikeIpv4(input)) return classifyIpAddress(input, 4);
  if (input.includes(":")) return classifyIpAddress(input, 6);
  return "not-an-ip";
}

function classifyIpAddress(address: string, family: number): "private" | "public" {
  if (family === 4) {
    return isPrivateIpv4(address) ? "private" : "public";
  }
  if (family === 6) {
    return isPrivateIpv6(address) ? "private" : "public";
  }
  // Unknown family — treat as private for safety.
  return "private";
}

function looksLikeIpv4(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n * 256 + v) >>> 0;
  }
  return n >>> 0;
}

const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], //         "this network"
  ["10.0.0.0", 8], //        RFC 1918
  ["100.64.0.0", 10], //     CGNAT
  ["127.0.0.0", 8], //       loopback
  ["169.254.0.0", 16], //    link-local (incl. cloud metadata 169.254.169.254)
  ["172.16.0.0", 12], //     RFC 1918
  ["192.0.0.0", 24], //      protocol assignments
  ["192.0.2.0", 24], //      TEST-NET-1
  ["192.168.0.0", 16], //    RFC 1918
  ["198.18.0.0", 15], //     benchmarking
  ["198.51.100.0", 24], //   TEST-NET-2
  ["203.0.113.0", 24], //    TEST-NET-3
  ["224.0.0.0", 4], //       multicast
  ["240.0.0.0", 4], //       reserved
  ["255.255.255.255", 32], // broadcast
];

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → treat as private
  for (const [base, bits] of PRIVATE_IPV4_RANGES) {
    const baseN = ipv4ToInt(base);
    if (baseN === null) continue;
    // bits === 32 → mask = 0xFFFFFFFF; bits === 0 → mask = 0.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) === (baseN & mask)) return true;
  }
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  // Unique local: fc00::/7 — any first byte 0xfc or 0xfd.
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true;
  // Link-local: fe80::/10 — first 10 bits 1111111010.
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // Multicast: ff00::/8.
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true;
  // IPv4-mapped: ::ffff:1.2.3.4 — delegate to v4 classification.
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(lower);
  if (v4Mapped) return isPrivateIpv4(v4Mapped[1]);
  // IPv4-compat (deprecated): ::1.2.3.4
  const v4Compat = /^::(\d+\.\d+\.\d+\.\d+)$/i.exec(lower);
  if (v4Compat) return isPrivateIpv4(v4Compat[1]);
  return false;
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
 * Resolve the SSRF-related download options from process env.
 * `runMediaPipeline`'s default download wires this in so a
 * self-hosted operator can opt into private-network imports
 * without having to pass `deps.download` themselves.
 *
 *   - `NP_WP_IMPORT_ALLOW_PRIVATE_HOSTS=1` (or `true`) skips the
 *     DNS / private-IP rejection step. ONLY use this when the
 *     source WXR genuinely lives on the same trusted private
 *     network as the importer.
 *   - `NP_WP_IMPORT_MAX_BYTES=<int>` overrides the 100 MiB
 *     body-size cap. Bumping this is the right knob for sites
 *     with large video assets.
 *
 * Invalid values (non-numeric `MAX_BYTES`, etc.) fall back to
 * the secure defaults silently — the goal is "don't refuse to
 * boot," not "reward typos with bigger surface area."
 */
export function resolveEnvDownloadOptions(env: NodeJS.ProcessEnv = process.env): DownloadOptions {
  const opts: DownloadOptions = {};
  const allow = env.NP_WP_IMPORT_ALLOW_PRIVATE_HOSTS;
  if (allow === "1" || allow === "true") {
    opts.allowPrivateHosts = true;
  }
  const maxBytesRaw = env.NP_WP_IMPORT_MAX_BYTES;
  if (maxBytesRaw) {
    const n = Number.parseInt(maxBytesRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      opts.maxBytes = n;
    }
  }
  return opts;
}

/**
 * The framework's upload routes accept image/*, video/*, and
 * application/pdf. Mirror that here so the importer doesn't push
 * anything through that the upload route would reject.
 */
export function isAllowedMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType === "application/pdf"
  );
}

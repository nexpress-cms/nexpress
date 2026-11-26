/** Fixed categories only; diagnostics never contain a URL, path, query value or credential. */
export interface NpSiteBuildBrowserRequestDiagnosticV1 {
  sink: "binding" | "fetch" | "request" | "socket";
  target:
    | "unknown"
    | "external"
    | "root"
    | "declared"
    | "document"
    | "static"
    | "image"
    | "api"
    | "other-local";
  query: "none" | "rsc" | "image" | "other";
  method: "GET" | "HEAD" | "POST" | "other";
}

/** Self-contained so the exact same fixed classifier can run in the bootstrap. */
export function classifySiteBuildBrowserRequestV1(
  href: unknown,
  method: unknown,
  origin: string,
  allowed: readonly string[],
  documents: readonly string[],
): Omit<NpSiteBuildBrowserRequestDiagnosticV1, "sink"> {
  const result: Omit<NpSiteBuildBrowserRequestDiagnosticV1, "sink"> = {
    target: "unknown",
    query: "none",
    method: method === "GET" || method === "HEAD" || method === "POST" ? method : "other",
  };
  if (typeof href !== "string" || href.length > 8192) return result;
  try {
    const url = new URL(href, origin);
    result.query = !url.search
      ? "none"
      : url.pathname === "/_next/image"
        ? "image"
        : /^\?_rsc(?:=|$)/u.test(url.search)
          ? "rsc"
          : "other";
    result.target =
      url.origin !== origin
        ? "external"
        : url.pathname === "/"
          ? "root"
          : allowed.includes(url.pathname)
            ? "declared"
            : documents.includes(url.pathname)
              ? "document"
              : url.pathname.startsWith("/_next/static/")
                ? "static"
                : url.pathname === "/_next/image"
                  ? "image"
                  : url.pathname.startsWith("/api/")
                    ? "api"
                    : "other-local";
  } catch {
    /* No input bytes survive a parse failure. */
  }
  return result;
}

export function requireSiteBuildBrowserRequestDiagnosticV1(
  value: unknown,
): NpSiteBuildBrowserRequestDiagnosticV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 4 ||
    ![row.sink, row.target, row.query, row.method].every((field) => typeof field === "string") ||
    !["binding", "fetch", "request", "socket"].includes(String(row.sink)) ||
    ![
      "unknown",
      "external",
      "root",
      "declared",
      "document",
      "static",
      "image",
      "api",
      "other-local",
    ].includes(String(row.target)) ||
    !["none", "rsc", "image", "other"].includes(String(row.query)) ||
    !["GET", "HEAD", "POST", "other"].includes(String(row.method))
  )
    return null;
  return {
    sink: row.sink,
    target: row.target,
    query: row.query,
    method: row.method,
  } as NpSiteBuildBrowserRequestDiagnosticV1;
}

export interface NpSiteBuildBrowserPendingRequestV1 {
  target: NpSiteBuildBrowserRequestDiagnosticV1["target"];
  query: NpSiteBuildBrowserRequestDiagnosticV1["query"];
  method: NpSiteBuildBrowserRequestDiagnosticV1["method"];
  apiRole:
    | "other"
    | "member-session"
    | "notifications"
    | "comments"
    | "reactions"
    | "engagement"
    | "follows"
    | "events";
  resourceType:
    | "other"
    | "document"
    | "stylesheet"
    | "image"
    | "media"
    | "font"
    | "script"
    | "xhr"
    | "fetch"
    | "eventsource";
  headersReceived: boolean;
  eventStream: boolean;
  ageMs: number;
}

export interface NpSiteBuildBrowserWaitDiagnosticV1 {
  step:
    "none" | "initial-idle" | "font-and-frames" | "post-font-idle" | "check-idle" | "frozen-idle";
  elapsedMs: number;
  stepElapsedMs: number;
  pendingCount: number;
  truncated: boolean;
  pending: readonly NpSiteBuildBrowserPendingRequestV1[];
}

export interface NpSiteBuildBrowserDiagnosticV1 {
  reason: "protocol" | "timeout" | "request" | "network" | "console" | "exception" | "target";
  loaded: boolean;
  inflight: number;
  /** Number of tracked iframe configuration tasks, not document/font readiness. */
  ready: number;
  request: NpSiteBuildBrowserRequestDiagnosticV1 | null;
  wait?: NpSiteBuildBrowserWaitDiagnosticV1;
  networkFailure?: {
    cause: "response" | "loading";
    status: number | null;
    error: "aborted" | "closed" | "reset" | "refused" | "timed-out" | "failed" | "other" | null;
    canceled: boolean;
    blocked: boolean;
    request: NpSiteBuildBrowserPendingRequestV1 | null;
  };
}

/** Metadata only: an API role never grants a request or broadens the policy. */
export function classifySiteBuildBrowserPendingRequestV1(
  href: unknown,
  method: unknown,
  resourceType: unknown,
  origin: string,
  allowed: readonly string[],
  documents: readonly string[],
  readRequests: readonly string[],
): Omit<NpSiteBuildBrowserPendingRequestV1, "headersReceived" | "eventStream" | "ageMs"> {
  const result: ReturnType<typeof classifySiteBuildBrowserPendingRequestV1> = {
    ...classifySiteBuildBrowserRequestV1(href, method, origin, allowed, documents),
    apiRole: "other",
    resourceType: "other",
  };
  const types: Record<string, NpSiteBuildBrowserPendingRequestV1["resourceType"]> = {
    Document: "document",
    Stylesheet: "stylesheet",
    Image: "image",
    Media: "media",
    Font: "font",
    Script: "script",
    XHR: "xhr",
    Fetch: "fetch",
    EventSource: "eventsource",
  };
  if (typeof resourceType === "string" && Object.hasOwn(types, resourceType))
    result.resourceType = types[resourceType]!;
  if (typeof href !== "string" || href.length > 8192 || method !== "GET") return result;
  try {
    const url = new URL(href, origin);
    const exact = url.pathname + url.search;
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      !readRequests.includes(exact)
    )
      return result;
    // These are the finite hydration shapes already owned by browser-request-policy.
    const slug = "[a-z][A-Za-z0-9_-]{0,63}";
    const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
    const target = `targetType=${slug}&targetId=${uuid}`;
    if (exact === "/api/members/me") result.apiRole = "member-session";
    else if (exact === "/api/notifications?count=1") result.apiRole = "notifications";
    else if (
      new RegExp(
        `^/api/collections/${slug}/${uuid}/comments\\?order=oldest&limit=20&offset=0$`,
        "u",
      ).test(exact)
    )
      result.apiRole = "comments";
    else if (new RegExp(`^/api/reactions\\?${target}&kind=like$`, "u").test(exact))
      result.apiRole = "reactions";
    else if (new RegExp(`^/api/engagement\\?${target}$`, "u").test(exact))
      result.apiRole = "engagement";
    else if (new RegExp(`^/api/follows/check\\?${target}$`, "u").test(exact))
      result.apiRole = "follows";
    else if (new RegExp(`^/api/community/events\\?scope=document&${target}$`, "u").test(exact))
      result.apiRole = "events";
  } catch {
    /* No input bytes survive a parse failure. */
  }
  return result;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const integer = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
const keys = (row: Record<string, unknown>, names: string[]) =>
  Object.keys(row).length === names.length && names.every((name) => Object.hasOwn(row, name));

/** Reject malformed optional telemetry; never copy native objects or unknown keys. */
function requireWait(value: unknown, inflight: number): NpSiteBuildBrowserWaitDiagnosticV1 | null {
  const row = object(value);
  // This is a serialization bound for host stalls, not a browser deadline extension.
  const maximumMs = 86_400_000;
  if (
    !row ||
    !keys(row, ["step", "elapsedMs", "stepElapsedMs", "pendingCount", "truncated", "pending"]) ||
    typeof row.step !== "string" ||
    ![
      "none",
      "initial-idle",
      "font-and-frames",
      "post-font-idle",
      "check-idle",
      "frozen-idle",
    ].includes(String(row.step)) ||
    !integer(row.elapsedMs, maximumMs) ||
    !integer(row.stepElapsedMs, row.elapsedMs) ||
    row.pendingCount !== inflight ||
    !Array.isArray(row.pending) ||
    row.pending.length !== Math.min(inflight, 8) ||
    row.truncated !== inflight > 8
  )
    return null;
  const pending: NpSiteBuildBrowserPendingRequestV1[] = [];
  for (const value of row.pending) {
    const item = object(value);
    if (
      !item ||
      !keys(item, [
        "target",
        "query",
        "method",
        "apiRole",
        "resourceType",
        "headersReceived",
        "eventStream",
        "ageMs",
      ]) ||
      !requireSiteBuildBrowserRequestDiagnosticV1({
        sink: "request",
        target: item.target,
        query: item.query,
        method: item.method,
      }) ||
      typeof item.apiRole !== "string" ||
      typeof item.resourceType !== "string" ||
      ![
        "other",
        "member-session",
        "notifications",
        "comments",
        "reactions",
        "engagement",
        "follows",
        "events",
      ].includes(String(item.apiRole)) ||
      ![
        "other",
        "document",
        "stylesheet",
        "image",
        "media",
        "font",
        "script",
        "xhr",
        "fetch",
        "eventsource",
      ].includes(String(item.resourceType)) ||
      typeof item.headersReceived !== "boolean" ||
      typeof item.eventStream !== "boolean" ||
      (item.eventStream && !item.headersReceived) ||
      !integer(item.ageMs, row.elapsedMs)
    )
      return null;
    pending.push({
      target: item.target,
      query: item.query,
      method: item.method,
      apiRole: item.apiRole,
      resourceType: item.resourceType,
      headersReceived: item.headersReceived,
      eventStream: item.eventStream,
      ageMs: item.ageMs,
    } as NpSiteBuildBrowserPendingRequestV1);
  }
  return {
    step: row.step,
    elapsedMs: row.elapsedMs,
    stepElapsedMs: row.stepElapsedMs,
    pendingCount: inflight,
    truncated: row.truncated,
    pending,
  } as NpSiteBuildBrowserWaitDiagnosticV1;
}

/** Shared native/CLI projection, including callers that construct a typed error directly. */
export function projectSiteBuildBrowserDiagnosticV1(
  value: unknown,
): NpSiteBuildBrowserDiagnosticV1 | null {
  const row = object(value);
  if (
    !row ||
    typeof row.reason !== "string" ||
    !["protocol", "timeout", "request", "network", "console", "exception", "target"].includes(
      String(row.reason),
    ) ||
    typeof row.loaded !== "boolean" ||
    !integer(row.inflight, 256) ||
    !integer(row.ready, 32)
  )
    return null;
  const request = object(row.request);
  const result: NpSiteBuildBrowserDiagnosticV1 = {
    reason: row.reason as NpSiteBuildBrowserDiagnosticV1["reason"],
    loaded: row.loaded,
    inflight: row.inflight,
    ready: row.ready,
    request: request
      ? requireSiteBuildBrowserRequestDiagnosticV1({
          sink: request.sink,
          target: request.target,
          query: request.query,
          method: request.method,
        })
      : null,
  };
  if (row.wait !== undefined) {
    const wait = requireWait(row.wait, row.inflight);
    if (wait) result.wait = wait;
  }
  const network = object(row.networkFailure);
  if (
    network &&
    keys(network, ["cause", "status", "error", "canceled", "blocked", "request"]) &&
    (network.cause === "response" || network.cause === "loading") &&
    (network.status === null || (integer(network.status, 599) && network.status >= 100)) &&
    (network.error === null ||
      (typeof network.error === "string" &&
        ["aborted", "closed", "reset", "refused", "timed-out", "failed", "other"].includes(
          network.error,
        ))) &&
    typeof network.canceled === "boolean" &&
    typeof network.blocked === "boolean" &&
    (network.cause === "response"
      ? network.error === null && !network.canceled && !network.blocked
      : network.status === null && network.error !== null)
  ) {
    // Apply the same bounded, value-free request projection as wait telemetry.
    const request = object(network.request);
    const pending = request
      ? requireWait(
          {
            step: "none",
            elapsedMs: request.ageMs,
            stepElapsedMs: 0,
            pendingCount: 1,
            truncated: false,
            pending: [request],
          },
          1,
        )?.pending[0]
      : null;
    if (network.request === null || pending)
      result.networkFailure = {
        cause: network.cause,
        status: network.status,
        error: network.error as NonNullable<
          NpSiteBuildBrowserDiagnosticV1["networkFailure"]
        >["error"],
        canceled: network.canceled,
        blocked: network.blocked,
        request: pending ?? null,
      };
  }
  return result;
}

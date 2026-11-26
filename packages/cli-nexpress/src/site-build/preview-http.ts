export interface NpSiteBuildPreviewHttpDiagnosticV1 {
  reason: "timeout" | "network" | "status" | "media" | "body-limit" | "privacy";
  status: number | null;
}
export class NpSiteBuildPreviewHttpFailureV1 extends Error {
  constructor(readonly diagnostic: NpSiteBuildPreviewHttpDiagnosticV1) {
    super("Build preview HTTP preparation failed");
  }
}
export function requireSiteBuildPreviewHttpDiagnosticV1(
  value: unknown,
): NpSiteBuildPreviewHttpDiagnosticV1 | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== 2 ||
    ["reason", "status"].some(
      (key) => !descriptors[key]?.enumerable || !("value" in descriptors[key]),
    )
  )
    return null;
  const data = {
    reason: descriptors.reason.value as unknown,
    status: descriptors.status.value as unknown,
  };
  if (
    typeof data.reason !== "string" ||
    !["timeout", "network", "status", "media", "body-limit", "privacy"].includes(data.reason) ||
    (data.status !== null &&
      (typeof data.status !== "number" ||
        !Number.isInteger(data.status) ||
        data.status < 100 ||
        data.status > 599))
  )
    return null;
  return {
    reason: data.reason as NpSiteBuildPreviewHttpDiagnosticV1["reason"],
    status: data.status,
  };
}

/** Fixed driver-only loopback read. No response body, URL or cookie enters a diagnostic. */
export async function requireSiteBuildPreviewHttpV1(input: {
  url: string;
  expected: "ready" | "anonymous-withheld";
  memberSessionToken?: string;
  /** Trusted internal deadline; the driver supplies a constant, never a project value. */
  timeoutMs: number;
}): Promise<void> {
  const url = new URL(input.url);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== input.url ||
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 60_000 ||
    (input.expected === "anonymous-withheld" && input.memberSessionToken !== undefined)
  )
    throw new NpSiteBuildPreviewHttpFailureV1({ reason: "network", status: null });
  let status: number | null = null;
  const fail = (reason: NpSiteBuildPreviewHttpDiagnosticV1["reason"]): never => {
    throw new NpSiteBuildPreviewHttpFailureV1({ reason, status });
  };
  try {
    const response = await fetch(input.url, {
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        Accept: "text/html",
        ...(input.memberSessionToken
          ? { Cookie: `np-mb-session=${input.memberSessionToken}` }
          : {}),
      },
    });
    status = response.status;
    if (response.status !== (input.expected === "ready" ? 200 : 404)) return fail("status");
    if (!response.body || !response.headers.get("content-type")?.startsWith("text/html"))
      return fail("media");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if ((count += next.value.length) > 2 * 1024 * 1024) return fail("body-limit");
        if (input.expected === "anonymous-withheld") chunks.push(next.value);
      }
      if (input.expected === "anonymous-withheld") {
        const html = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        if (html.includes('data-np-forum-surface="post-detail"')) return fail("privacy");
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch (error) {
    if (error instanceof NpSiteBuildPreviewHttpFailureV1) throw error;
    return fail(
      error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)
        ? "timeout"
        : "network",
    );
  }
}
import { types } from "node:util";

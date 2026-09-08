import { createHash } from "node:crypto";
import { withAgentChangeSetPreviewRender } from "@nexpress/next";
import { NpError } from "@nexpress/core";
import {
  npRequireAgentPreviewDetailWireV1,
  npAgentChangeSetLimits,
} from "@nexpress/core/agent-contract";
import {
  getOptionalAgentStudioServerRuntimeV1,
  npAgentPreviewNonce,
  npRequireAgentPreviewRenderOrigin,
  npAgentPreviewHtmlHeaders,
  npAgentPreviewViewerCookie,
  type NpAgentStudioServerRuntimeV1,
} from "@nexpress/core/agents";
import { withCurrentSite } from "@nexpress/core/sites";
import type { NextRequest } from "next/server";
import { npErrorResponse, npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { requireAgentOauthStaff, normalizeAgentStudioError } from "./studio-admin";
import { readExactOauthForm } from "./oauth-http";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export interface NpAgentPreviewImmutableAssetOptionsV1 {
  /** Exact immutable framework asset paths only. No request, cookie, or authority is passed to a loader. */
  immutableAssets?: Readonly<Record<string, () => Promise<Response>>>;
}
const ASSET_MIMES = new Set([
  "application/javascript",
  "application/javascript; charset=utf-8",
  "text/javascript",
  "text/javascript; charset=utf-8",
  "text/css",
  "text/css; charset=utf-8",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "font/woff2",
  "font/woff",
]);
async function immutableAsset(
  request: Request,
  url: URL,
  options: NpAgentPreviewImmutableAssetOptionsV1,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/__np/assets/"))
    return null;
  const load = Object.hasOwn(options.immutableAssets ?? {}, url.pathname)
    ? options.immutableAssets?.[url.pathname]
    : undefined;
  if (
    !load ||
    !["GET", "HEAD"].includes(request.method) ||
    request.body !== null ||
    (request.headers.get("content-length") !== null &&
      request.headers.get("content-length") !== "0") ||
    !/^\/(?:_next\/static|__np\/assets)\/[A-Za-z0-9._/-]+$/u.test(url.pathname) ||
    url.pathname.split("/").some((part) => part === "." || part === "..") ||
    url.pathname.includes("//") ||
    request.headers.has("x-np-preview-render") ||
    request.headers.has("x-np-preview-capture")
  )
    return unavailable();
  let expired = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async (): Promise<Response> => {
    const response = await load();
    if (expired) {
      void response.body?.cancel().catch(() => undefined);
      return unavailable();
    }
    const mime = response.headers.get("content-type") ?? "";
    if (
      response.status !== 200 ||
      !ASSET_MIMES.has(mime) ||
      response.headers.has("content-encoding")
    ) {
      void response.body?.cancel().catch(() => undefined);
      return unavailable();
    }
    reader = response.body?.getReader();
    if (!reader) return unavailable();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > npAgentChangeSetLimits.previewHtmlBytes) {
          await reader.cancel();
          return unavailable();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(request.method === "HEAD" ? null : bytes, {
      headers: {
        "content-type": mime,
        "content-length": String(length),
        "cache-control": "public, max-age=31536000, immutable",
        etag: `"sha256-${createHash("sha256").update(bytes).digest("base64url")}"`,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cross-origin-resource-policy": "same-origin",
        "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    });
  };
  try {
    return await Promise.race([
      work(),
      new Promise<Response>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          void reader?.cancel().catch(() => undefined);
          resolve(unavailable());
        }, npAgentChangeSetLimits.renderLifetimeSeconds * 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function unavailable(headers: Record<string, string> = {}): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store",
      pragma: "no-cache",
      "x-robots-tag": "noindex, nofollow, noarchive",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}
function exactOrigin(request: Request, origin: string): URL {
  const url = new URL(request.url);
  if (
    url.origin !== origin ||
    request.headers.get("host") !== url.host ||
    url.search ||
    url.hash ||
    request.headers.has("authorization") ||
    request.headers.has("content-encoding")
  )
    throw new Error("Invalid preview request.");
  return url;
}
async function jsonBody(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
      request.headers.get("content-type") ?? "",
    ) ||
    request.headers.has("content-encoding")
  )
    throw new NpError("Invalid input", "VALIDATION_ERROR", 400);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^(0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > 16384))
    throw new NpError("Invalid input", "VALIDATION_ERROR", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new NpError("Invalid input", "VALIDATION_ERROR", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16384) {
        await reader.cancel();
        throw new NpError("Invalid input", "VALIDATION_ERROR", 400);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function rendered(response: Response, nonce: string): Response {
  if (
    response.status !== 200 ||
    !/^text\/html(?:\s*;\s*charset=utf-8)?$/iu.test(response.headers.get("content-type") ?? "")
  )
    throw new Error("Invalid preview response.");
  return new Response(response.body, { headers: npAgentPreviewHtmlHeaders(nonce) });
}
export async function handleAgentPreviewAdminRequest(
  request: NextRequest,
  operation: "create" | "get" | "launch",
  ids: { id: string; previewId?: string },
): Promise<Response> {
  try {
    if (request.nextUrl.search) throw new NpError("Invalid input", "VALIDATION_ERROR", 400);
    await ensureFor(operation === "get" ? "read" : "write");
    const { siteId, actor } = await requireAgentOauthStaff(request);
    const runtime = getOptionalAgentStudioServerRuntimeV1();
    if (!runtime?.changesets) return unavailable();
    if (operation === "launch") {
      if (!runtime.previewAccess || !runtime.previewRenderer || !ids.previewId)
        return unavailable();
      const result = await runtime.previewAccess.launch({
        siteId,
        actor,
        changeSetId: ids.id,
        previewId: ids.previewId,
        command: await jsonBody(request),
      });
      return new Response(result.html, { headers: result.headers });
    }
    const staff = { kind: "staff" as const, siteId, actor };
    const result =
      operation === "get"
        ? await runtime.changesets.getPreview({
            actor: staff,
            previewId: ids.previewId!,
            changeSetId: ids.id,
          })
        : await runtime.changesets.preview({
            actor: staff,
            id: ids.id,
            command: await jsonBody(request),
          });
    return npSuccessResponse(npRequireAgentPreviewDetailWireV1(result, siteId), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const response = npErrorResponse(normalizeAgentStudioError(error), {
      headers: { "cache-control": "private, no-store" },
    });
    if (
      error instanceof NpError &&
      error.code === "RATE_LIMITED" &&
      typeof error.details === "object" &&
      error.details !== null &&
      "retryAfterSeconds" in error.details &&
      typeof error.details.retryAfterSeconds === "number"
    )
      response.headers.set("retry-after", String(error.details.retryAfterSeconds));
    return response;
  }
}

/** Explicit dedicated-origin handler; never mount this as a production site catch-all/proxy. */
export async function handleAgentPreviewOriginRequest(
  request: Request,
  options: NpAgentPreviewImmutableAssetOptionsV1 = {},
): Promise<Response> {
  let previewId: string | undefined;
  try {
    const runtime = getOptionalAgentStudioServerRuntimeV1();
    const access = runtime?.previewAccess;
    if (!access) return unavailable();
    const url = exactOrigin(request, access.previewOrigin);
    const asset = await immutableAsset(request, url, options);
    if (asset) return asset;
    if (request.headers.has("x-np-preview-render") || request.headers.has("x-np-preview-capture"))
      return unavailable();
    if (url.pathname === "/__np/launch" && request.method === "POST") {
      const origin = request.headers.get("origin");
      if (!origin) return unavailable();
      const { exchange } = await readExactOauthForm(request, ["exchange"], ["exchange"]);
      const response = await access.activate({ exchange, origin });
      return new Response(response.html, { headers: response.headers });
    }
    const match = new RegExp(`^/__np/view/(${UUID})/(${UUID})/([^/]+)$`, "u").exec(url.pathname);
    if (
      !match ||
      request.method !== "GET" ||
      !runtime.changesets ||
      !runtime.previewRenderer ||
      (request.headers.get("origin") !== null &&
        request.headers.get("origin") !== access.previewOrigin)
    )
      return unavailable();
    previewId = match[1];
    return await access.view({
      previewId,
      launchId: match[2],
      encodedRoute: match[3],
      cookie: request.headers.get("cookie") ?? "",
      render: ({ preview, route, locale, viewer }) =>
        withCurrentSite(preview.siteId, () =>
          runtime.changesets!.renderPreview({
            siteId: preview.siteId,
            previewId: preview.id,
            viewer,
            route: { route, locale, audience: "public" },
            render: async (context) => {
              const nonce = npAgentPreviewNonce();
              return rendered(
                await withAgentChangeSetPreviewRender(context, () =>
                  runtime.previewRenderer!(context, { nonce }),
                ),
                nonce,
              );
            },
          }),
        ),
    });
  } catch {
    return unavailable(
      previewId ? { "set-cookie": npAgentPreviewViewerCookie({ previewId, clear: true }) } : {},
    );
  }
}

/** Called only by a host-injected ephemeral HTTPS loopback listener with a pinned IP-SAN certificate. */
export async function handleAgentPreviewRenderRequest(
  request: Request,
  input: {
    origin: string;
    runtime: NpAgentStudioServerRuntimeV1;
  } & NpAgentPreviewImmutableAssetOptionsV1,
): Promise<Response> {
  try {
    const url = exactOrigin(request, npRequireAgentPreviewRenderOrigin(input.origin));
    const { previewAccess: access, changesets, previewRenderer } = input.runtime;
    if (!access || !changesets || !previewRenderer) return unavailable();
    const asset = await immutableAsset(request, url, input);
    if (asset) return asset;
    if (url.pathname === "/__np/preview/render-bootstrap" && request.method === "POST") {
      const token = request.headers.get("x-np-preview-render");
      if (!token || request.headers.has("cookie") || request.headers.has("x-np-preview-capture"))
        return unavailable();
      const result = await access.bootstrapRender({
        token,
        origin: input.origin,
        body: await jsonBody(request),
      });
      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": result.cookie,
          "cache-control": "private, no-store",
          pragma: "no-cache",
        },
      });
    }
    const match = new RegExp(`^/__np/preview/render-route/(${UUID})/([1-9]|1[0-9]|20)$`, "u").exec(
      url.pathname,
    );
    if (
      !match ||
      request.method !== "GET" ||
      request.headers.has("x-np-preview-render") ||
      !["none", "same-origin"].includes(request.headers.get("sec-fetch-site") ?? "") ||
      request.headers.get("sec-fetch-mode") !== "navigate" ||
      request.headers.get("sec-fetch-dest") !== "document"
    )
      return unavailable();
    const ticket = request.headers.get("x-np-preview-capture");
    if (!ticket) return unavailable();
    const { preview, capture } = await access.consumeCapture({
      renderSessionId: match[1],
      ordinal: Number(match[2]),
      cookie: request.headers.get("cookie") ?? "",
      ticket,
    });
    return await withCurrentSite(preview.siteId, () =>
      changesets.renderPreview({
        siteId: preview.siteId,
        previewId: preview.id,
        route: { route: capture.route, locale: capture.locale, audience: "public" },
        render: async (context) => {
          const nonce = npAgentPreviewNonce();
          return rendered(
            await withAgentChangeSetPreviewRender(context, () =>
              previewRenderer(context, { nonce }),
            ),
            nonce,
          );
        },
      }),
    );
  } catch {
    return unavailable();
  }
}

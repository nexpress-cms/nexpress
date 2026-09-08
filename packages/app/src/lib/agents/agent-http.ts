import { withCurrentSite } from "@nexpress/core/sites";
import { NpError } from "@nexpress/core";
import { npCreateApiError } from "@nexpress/core/api-contract";
import {
  npAgentHttpLimitsV1,
  npRequireAgentHttpCapabilitiesV1,
  npRequireAgentReadCapabilityInvocationResultV1,
  npRequireAgentActivityRunDetailV1,
} from "@nexpress/core/agent-contract";
import {
  getOptionalAgentStudioServerRuntimeV1,
  NpAgentHttpErrorV1,
  npAgentPreviewArtifactHeaders,
  npAgentPreviewNonce,
} from "@nexpress/core/agents";
import { ensureFor } from "../init-core";

const errors = {
  400: ["VALIDATION_ERROR", "Invalid input"],
  401: ["AUTHENTICATION_REQUIRED", "Authentication required"],
  403: ["FORBIDDEN", "Access denied"],
  404: ["NOT_FOUND", "Resource not found"],
  409: ["CONFLICT", "Request conflicts with current state"],
  429: ["RATE_LIMITED", "Too many requests"],
  500: ["INTERNAL_ERROR", "An unexpected error occurred"],
  503: ["SERVICE_UNAVAILABLE", "Service unavailable"],
} as const;
export function agentHttpErrorResponse(error: unknown): Response {
  const status =
    error instanceof NpAgentHttpErrorV1
      ? error.status
      : error instanceof NpError && error.statusCode in errors
        ? (error.statusCode as keyof typeof errors)
        : 500;
  const [code, message] = errors[status];
  return Response.json(
    npCreateApiError(
      code,
      message,
      status,
      status === 400 ? [{ field: "request", message: "Invalid input" }] : undefined,
    ),
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
      },
    },
  );
}
async function body(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
      request.headers.get("content-type") ?? "",
    ) ||
    request.headers.has("content-encoding")
  )
    throw new NpAgentHttpErrorV1(400);
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > npAgentHttpLimitsV1.requestBytes)
  )
    throw new NpAgentHttpErrorV1(400);
  const reader = request.body?.getReader();
  if (!reader) throw new NpAgentHttpErrorV1(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > npAgentHttpLimitsV1.requestBytes) {
        await reader.cancel();
        throw new NpAgentHttpErrorV1(400);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new NpAgentHttpErrorV1(400);
  } finally {
    reader.releaseLock();
  }
}
export type AgentHttpOperation = "capabilities" | "invocations" | "run" | "artifact";
export async function handleAgentHttpRequest(
  request: Request,
  operation: AgentHttpOperation,
  ids: { runId?: string; previewId?: string; artifactId?: string } = {},
): Promise<Response> {
  try {
    await ensureFor("read");
    const gateway = getOptionalAgentStudioServerRuntimeV1()?.agentHttp;
    if (!gateway) throw new NpAgentHttpErrorV1(404);
    const expected =
      operation === "capabilities"
        ? "/api/agent/v1/capabilities"
        : operation === "invocations"
          ? "/api/agent/v1/invocations"
          : operation === "run"
            ? `/api/agent/v1/runs/${ids.runId}`
            : `/api/agent/v1/previews/${ids.previewId}/artifacts/${ids.artifactId}`;
    const url = new URL(request.url);
    if (
      url.pathname !== expected ||
      url.search ||
      url.hash ||
      request.method !== (operation === "invocations" ? "POST" : "GET")
    )
      throw new NpAgentHttpErrorV1(404);
    // Cookies and host-selected Admin context never participate in machine authority.
    if (request.headers.has("cookie") || request.headers.has("x-np-admin-site"))
      throw new NpAgentHttpErrorV1(401);
    const accept = request.headers.get("accept");
    if (
      accept &&
      !accept
        .split(",")
        .some((v) => /^(?:\*\/\*|application\/json)(?:\s*;.*)?$/iu.test(v.trim())) &&
      operation !== "artifact"
    )
      throw new NpAgentHttpErrorV1(400);
    const authentication = await gateway.authenticate({
      authorization: request.headers.get("authorization"),
      requestUrl: request.url,
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
    });
    return await withCurrentSite(authentication.principal.siteId, async () => {
      await ensureFor("plugins");
      if (operation === "artifact") {
        const artifact = await gateway.readArtifact(
          authentication,
          ids.previewId!,
          ids.artifactId!,
        );
        if (
          !(artifact.bytes instanceof Uint8Array) ||
          artifact.bytes.byteLength === 0 ||
          artifact.bytes.byteLength > npAgentHttpLimitsV1.artifactBytes ||
          !["image/png", "image/webp", "application/json"].includes(artifact.mime)
        )
          throw new NpAgentHttpErrorV1(500);
        return new Response(artifact.bytes as BodyInit, {
          headers: npAgentPreviewArtifactHeaders({
            artifactId: ids.artifactId!,
            mime: artifact.mime,
            size: artifact.bytes.byteLength,
            contentDigest: artifact.contentDigest,
            nonce: npAgentPreviewNonce(),
          }),
        });
      }
      const result =
        operation === "capabilities"
          ? await gateway.capabilities(authentication)
          : operation === "invocations"
            ? await gateway.invoke(authentication, await body(request), request.signal)
            : await gateway.getRun(authentication, ids.runId!);
      const safeResult =
        operation === "capabilities"
          ? npRequireAgentHttpCapabilitiesV1(result)
          : operation === "invocations"
            ? npRequireAgentReadCapabilityInvocationResultV1(result)
            : npRequireAgentActivityRunDetailV1(result);
      const serialized = JSON.stringify(safeResult);
      if (new TextEncoder().encode(serialized).byteLength > npAgentHttpLimitsV1.responseBytes)
        throw new NpAgentHttpErrorV1(500);
      return new Response(serialized, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    });
  } catch (error) {
    return agentHttpErrorResponse(error);
  }
}

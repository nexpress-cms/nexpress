import { NpAgentHttpErrorV1, getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import { NP_AGENT_GUARDIAN_EXTERNAL_BODY_LIMIT_V1 } from "@nexpress/core/agent-contract";
import { ensureFor } from "../init-core";
import { agentHttpErrorResponse } from "./agent-http";

const path = "/api/agents/security/sentry";
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/** Retain the exact signed bytes; never parse/re-encode upstream JSON before verification. */
async function rawBody(request: Request, signal: AbortSignal): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (
    request.headers.has("content-encoding") ||
    (declared !== null &&
      (!/^(?:0|[1-9][0-9]*)$/u.test(declared) ||
        !Number.isSafeInteger(Number(declared)) ||
        Number(declared) > NP_AGENT_GUARDIAN_EXTERNAL_BODY_LIMIT_V1))
  )
    throw new NpAgentHttpErrorV1(400);
  const reader = request.body?.getReader();
  if (!reader) throw new NpAgentHttpErrorV1(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new NpAgentHttpErrorV1(400));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.byteLength;
      if (size > NP_AGENT_GUARDIAN_EXTERNAL_BODY_LIMIT_V1) throw new NpAgentHttpErrorV1(400);
      chunks.push(value.slice());
    }
    if (!size || (declared !== null && Number(declared) !== size))
      throw new NpAgentHttpErrorV1(400);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch {
    // Cancellation must not wait for an uncooperative stream producer.
    void reader.cancel().catch(() => undefined);
    throw new NpAgentHttpErrorV1(400);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Public machine callback: the explicitly installed source owns signature and fixed site binding. */
export async function handleGuardianSentryRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== path || url.search || url.hash)
      throw new NpAgentHttpErrorV1(404);
    // Neither browser authority nor caller-selected site routing participates in this protocol.
    if (
      request.headers.has("cookie") ||
      request.headers.has("authorization") ||
      request.headers.has("x-np-admin-site")
    )
      throw new NpAgentHttpErrorV1(401);
    await ensureFor("read");
    const source = getOptionalAgentStudioServerRuntimeV1()?.guardianSentry;
    if (!source) throw new NpAgentHttpErrorV1(404);
    const signature = request.headers.get("sentry-hook-signature");
    const resource = request.headers.get("sentry-hook-resource");
    if (!signature || !resource || signature.length > 128 || resource.length > 64)
      throw new NpAgentHttpErrorV1(401);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
    const bytes = await rawBody(request, signal);
    const result = await source.ingest({ rawBody: bytes, signature, resource, signal });
    if (!["recorded", "replayed", "ignored"].includes(result.disposition))
      throw new NpAgentHttpErrorV1(500);
    // An authenticated ignored/disabled fact is acknowledged without disclosing local coverage.
    return Response.json({ received: true }, { status: 202, headers });
  } catch (error) {
    return agentHttpErrorResponse(error);
  }
}

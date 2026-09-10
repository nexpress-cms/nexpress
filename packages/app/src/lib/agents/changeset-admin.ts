import { NpValidationError } from "@nexpress/core";
import {
  npRequireAgentApprovalDetailV1,
  npRequireAgentChangeSetWire,
  npRequireAgentChangeSetReviewV1,
  npAnalyzeAgentChangeSetWire,
  npAnalyzeAgentCursorPageV1,
  npRequireAgentContractResult,
  npAgentChangeSetLimits,
  npRequireAgentInstalledCapabilityInputV1,
} from "@nexpress/core/agent-contract";
import {
  getOptionalAgentStudioServerRuntimeV1,
  npAgentPreviewArtifactHeaders,
  npAgentPreviewNonce,
} from "@nexpress/core/agents";
import type { NextRequest } from "next/server";
import { npErrorResponse, npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { requireAgentOauthStaff, normalizeAgentStudioError } from "./studio-admin";

export function readChangeSetQuery(request: NextRequest) {
  const invalid = () =>
    new NpValidationError("Invalid ChangeSet query.", [
      { field: "query", message: "Use the bounded ChangeSet query contract." },
    ]);
  if (request.nextUrl.search.length > 8192) throw invalid();
  const values: Record<string, unknown> = {
    states: [],
    actorKinds: [],
    createdAfter: null,
    createdBefore: null,
    limit: 25,
    cursor: null,
  };
  const seen = new Set<string>();
  for (const [key, value] of request.nextUrl.searchParams) {
    if (seen.has(key) || !Object.hasOwn(values, key) || !value) throw invalid();
    seen.add(key);
    if (key === "limit") {
      if (!/^[1-9][0-9]{0,2}$/u.test(value)) throw invalid();
      values[key] = Number(value);
    } else values[key] = key === "states" || key === "actorKinds" ? value.split(",") : value;
  }
  try {
    const result = npRequireAgentInstalledCapabilityInputV1("changeset.list", values);
    return { ...result, cursor: result.cursor ?? undefined };
  } catch {
    throw invalid();
  }
}

export async function readAgentAdminJsonBody(
  request: NextRequest,
  maximumBytes = npAgentChangeSetLimits.adminProposalCharacters * 6 + 16384,
): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
      request.headers.get("content-type") ?? "",
    ) ||
    request.headers.has("content-encoding")
  )
    throw new NpValidationError("Invalid input.", [
      { field: "request", message: "Use the exact bounded JSON request contract." },
    ]);
  const reader = request.body?.getReader();
  if (!reader)
    throw new NpValidationError("Invalid input.", [
      { field: "request", message: "Use the exact bounded JSON request contract." },
    ]);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new NpValidationError("Invalid input.", [
          { field: "request", message: "Use the exact bounded JSON request contract." },
        ]);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new NpValidationError("Invalid input.", [
      { field: "request", message: "Request must be valid UTF-8 JSON." },
    ]);
  }
}
export async function handleAgentChangeSetAdminRequest(
  request: NextRequest,
  operation:
    | "list"
    | "get"
    | "create"
    | "update"
    | "validate"
    | "artifact"
    | "apply"
    | "schedule"
    | "cancel"
    | "prepareRollback"
    | "requestRollbackApproval"
    | "executeRollback",
  ids: { id?: string; previewId?: string; artifactId?: string; rollbackPlanId?: string } = {},
): Promise<Response> {
  const headers = {
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  try {
    if (
      operation === "artifact" &&
      [ids.id, ids.previewId, ids.artifactId].some(
        (id) =>
          typeof id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id),
      )
    )
      return new Response("Not found", { status: 404, headers });
    if (operation !== "list" && request.nextUrl.search)
      throw new NpValidationError("Invalid input.", [
        { field: "request", message: "Use the exact bounded JSON request contract." },
      ]);
    await ensureFor(["list", "get", "artifact"].includes(operation) ? "read" : "write");
    const staff = await requireAgentOauthStaff(request);
    const service = getOptionalAgentStudioServerRuntimeV1()?.changesets;
    if (!service) return new Response("Not found", { status: 404, headers });
    const actor = { kind: "staff" as const, ...staff };
    if (operation === "list") {
      const result = await service.list({ actor, ...readChangeSetQuery(request) });
      return npSuccessResponse(
        npRequireAgentContractResult(
          npAnalyzeAgentCursorPageV1(result, {
            schemaVersion: "np.agent-changesets.v1",
            analyzeItem: npAnalyzeAgentChangeSetWire,
            itemIssueRoot: "agent.changeset.wire",
            maximumDepth: 64,
            maximumBytes: npAgentChangeSetLimits.wireBytes,
          }),
        ),
        { headers },
      );
    }
    if (operation === "get")
      return npSuccessResponse(
        npRequireAgentChangeSetReviewV1(await service.getReview({ actor, id: ids.id! })),
        { headers },
      );
    if (operation === "artifact") {
      await service.getPreview({ actor, changeSetId: ids.id!, previewId: ids.previewId! });
      const result = await service.readPreviewArtifact({
        actor,
        previewId: ids.previewId!,
        artifactId: ids.artifactId!,
      });
      if (!["image/png", "image/webp", "application/json"].includes(result.mime))
        throw new Error("Unavailable artifact");
      return new Response(new Uint8Array(result.bytes), {
        headers: npAgentPreviewArtifactHeaders({
          artifactId: ids.artifactId!,
          mime: result.mime as "image/png" | "image/webp" | "application/json",
          size: result.bytes.byteLength,
          contentDigest: result.contentDigest,
          nonce: npAgentPreviewNonce(),
        }),
      });
    }
    const command = await readAgentAdminJsonBody(request);
    if (operation === "prepareRollback")
      return npSuccessResponse(
        npRequireAgentChangeSetReviewV1(
          await service.prepareRollback({ actor, id: ids.id!, command }),
        ),
        { headers },
      );
    if (operation === "requestRollbackApproval")
      return npSuccessResponse(
        npRequireAgentApprovalDetailV1(
          await service.requestRollbackApproval({
            actor,
            id: ids.id!,
            rollbackPlanId: ids.rollbackPlanId!,
            command,
          }),
        ),
        { headers },
      );
    if (operation === "executeRollback")
      return npSuccessResponse(
        npRequireAgentChangeSetReviewV1(
          await service.executeRollback({
            actor,
            id: ids.id!,
            rollbackPlanId: ids.rollbackPlanId!,
            command,
          }),
        ),
        { headers },
      );
    if (operation === "apply" || operation === "schedule" || operation === "cancel") {
      return npSuccessResponse(
        npRequireAgentChangeSetReviewV1(await service[operation]({ actor, id: ids.id!, command })),
        { headers },
      );
    }
    const result =
      operation === "create"
        ? await service.create({ actor, command })
        : operation === "update"
          ? await service.update({ actor, id: ids.id!, command })
          : await service.validate({ actor, id: ids.id!, command });
    return npSuccessResponse(npRequireAgentChangeSetWire(result), { headers });
  } catch (error) {
    if (operation === "artifact") return new Response("Not found", { status: 404, headers });
    return npErrorResponse(normalizeAgentStudioError(error), { headers });
  }
}

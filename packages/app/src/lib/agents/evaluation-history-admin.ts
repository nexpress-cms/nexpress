import { NpServiceUnavailableError, NpValidationError } from "@nexpress/core";
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import {
  npAgentEvaluationHistoryRequestMaxBytesV1,
  npRequireAgentEvaluationHistorySaveV1,
  npRequireAgentEvaluationHistorySourcesV1,
  npRequireAgentEvaluationHistoryDetailV1,
  npRequireAgentEvaluationHistoryCaseV1,
  npRequireAgentEvaluationHistorySavedV1,
} from "@nexpress/core/agent-contract";
import type { NextRequest } from "next/server";
import { npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { requireAgentStudioAdmin } from "./studio-admin";
import { readAgentAdminJsonBody } from "./changeset-admin";
import { agentStudioErrorResponse } from "./studio-error-response";
const headers = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
const invalid = () =>
  new NpValidationError("Invalid evaluation history request.", [
    { field: "request", message: "Use the bounded evaluation history request contract." },
  ]);
function query(request: NextRequest) {
  if (request.nextUrl.search.length > 4096) throw invalid();
  const values: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (
      !["cursor", "sourceId", "caseId", "caseVersion", "before", "sourceHash", "recipe"].includes(
        key,
      ) ||
      Object.hasOwn(values, key) ||
      !value ||
      value.length > 128
    )
      throw invalid();
    values[key] = value;
  }
  if (values.sourceId) {
    if (values.cursor) throw invalid();
    if ((values.caseId === undefined) !== (values.caseVersion === undefined)) throw invalid();
    if (!values.caseId && values.before) throw invalid();
  } else if (values.caseId || values.caseVersion || values.before) throw invalid();
  if (
    (values.sourceHash === undefined) !== (values.recipe === undefined) ||
    (values.sourceHash && (values.cursor || values.sourceId))
  )
    throw invalid();
  for (const key of ["caseVersion", "before"])
    if (values[key] && !/^[1-9][0-9]{0,9}$/u.test(values[key])) throw invalid();
  return values;
}
/** Evidence persistence is explicit host injection; absent installation remains disabled. */
export async function handleAgentEvaluationHistoryRequest(request: NextRequest): Promise<Response> {
  const mutation = request.method === "POST";
  try {
    if (!["GET", "POST"].includes(request.method)) throw invalid();
    await ensureFor(mutation ? "write" : "read");
    const staff = await requireAgentStudioAdmin(request);
    const service = getOptionalAgentStudioServerRuntimeV1()?.evaluationHistory;
    if (!service)
      throw new NpServiceUnavailableError("Authenticated evaluation history is unavailable.");
    let result: unknown;
    if (mutation) {
      if (request.nextUrl.search) throw invalid();
      let command;
      try {
        command = npRequireAgentEvaluationHistorySaveV1(
          await readAgentAdminJsonBody(request, npAgentEvaluationHistoryRequestMaxBytesV1),
        );
      } catch {
        throw invalid();
      }
      result = npRequireAgentEvaluationHistorySavedV1(await service.save({ ...staff, command }));
    } else {
      const q = query(request);
      if (!q.sourceId)
        result = npRequireAgentEvaluationHistorySourcesV1(
          await service.list({
            ...staff,
            cursor: q.cursor ?? null,
            recipe: q.recipe,
            sourceHash: q.sourceHash,
          }),
        );
      else if (q.caseId) {
        const value = npRequireAgentEvaluationHistoryCaseV1(
          await service.history({
            ...staff,
            sourceId: q.sourceId,
            caseId: q.caseId,
            caseVersion: Number(q.caseVersion),
            before: q.before ? Number(q.before) : null,
          }),
        );
        if (
          value.source.id !== q.sourceId ||
          value.caseId !== q.caseId ||
          value.caseVersion !== Number(q.caseVersion)
        )
          throw invalid();
        result = value;
      } else {
        const value = npRequireAgentEvaluationHistoryDetailV1(
          await service.get({ ...staff, sourceId: q.sourceId }),
        );
        if (value.source.id !== q.sourceId) throw invalid();
        result = value;
      }
    }
    return npSuccessResponse(result, { headers });
  } catch (error) {
    return agentStudioErrorResponse(error, mutation ? "mutation" : "read", { headers }, request);
  }
}

import {
  npRequireAgentEvaluationHistorySaveV1,
  npRequireAgentEvaluationHistorySavedV1,
  npRequireAgentEvaluationHistorySourcesV1,
  npRequireAgentEvaluationHistoryDetailV1,
  npRequireAgentEvaluationHistoryCaseV1,
  type NpAgentEvaluationHistorySaveV1,
} from "@nexpress/core/agent-contract";
import { npFetch } from "../lib/api-client.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";
const base = "/api/admin/agents/evaluations/history";
async function read(query: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
  const response = await npFetch(`${base}?${query}`, { cache: "no-store", signal });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
export async function listAgentEvaluationHistory(cursor: string | null, signal?: AbortSignal) {
  const q = new URLSearchParams();
  if (cursor) q.set("cursor", cursor);
  return npRequireAgentEvaluationHistorySourcesV1(await read(q, signal));
}
export async function loadAgentEvaluationHistory(sourceId: string, signal?: AbortSignal) {
  const value = npRequireAgentEvaluationHistoryDetailV1(
    await read(new URLSearchParams({ sourceId }), signal),
  );
  if (value.source.id !== sourceId) throw new Error("Evaluation source mismatch.");
  return value;
}
export async function readAgentEvaluationCaseHistory(
  sourceId: string,
  caseId: string,
  caseVersion: number,
  before: number | null,
  signal?: AbortSignal,
) {
  const q = new URLSearchParams({ sourceId, caseId, caseVersion: String(caseVersion) });
  if (before) q.set("before", String(before));
  const v = npRequireAgentEvaluationHistoryCaseV1(await read(q, signal));
  if (v.source.id !== sourceId || v.caseId !== caseId || v.caseVersion !== caseVersion)
    throw new Error("Evaluation case mismatch.");
  return v;
}
export async function saveAgentEvaluationHistory(
  command: NpAgentEvaluationHistorySaveV1,
  signal?: AbortSignal,
): Promise<{ resourceId: string; replayed: boolean }> {
  const response = await npFetch(base, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(npRequireAgentEvaluationHistorySaveV1(command)),
    signal,
  });
  if (!response.ok) throw await responseError(response);
  try {
    return npRequireAgentEvaluationHistorySavedV1(await response.json());
  } catch {
    throw new AgentStudioApiError(
      "The saved evaluation response could not be validated.",
      502,
      "STUDIO_CONTRACT_ERROR",
    );
  }
}

export async function findAgentEvaluationHistory(
  recipe: string,
  sourceHash: string,
  signal?: AbortSignal,
) {
  const value = npRequireAgentEvaluationHistorySourcesV1(
    await read(new URLSearchParams({ recipe, sourceHash }), signal),
  );
  if (
    value.sources.length > 1 ||
    value.sources.some((s) => s.recipe !== recipe || s.sourceHash !== sourceHash) ||
    value.nextCursor !== null
  )
    throw new Error("Evaluation source lookup mismatch.");
  return value;
}

import {
  npAgentEvaluationWorkbenchRequestMaxBytesV1,
  npRequireAgentEvaluationWorkbenchRequestV1,
  npRequireAgentEvaluationWorkbenchResultV1,
  type NpAgentEvaluationWorkbenchCaseV1,
  type NpAgentEvaluationWorkbenchRequestV1,
  type NpAgentEvaluationWorkbenchResultV1,
  type NpAgentEvaluationWorkbenchOutcomeV1,
} from "@nexpress/core/agent-contract";
import { npFetch } from "../lib/api-client.js";
import { AgentStudioApiError, responseError } from "./agent-studio-api.js";

export async function processAgentEvaluationWorkbench(
  input: NpAgentEvaluationWorkbenchRequestV1,
  signal?: AbortSignal,
): Promise<NpAgentEvaluationWorkbenchResultV1> {
  const body = JSON.stringify(npRequireAgentEvaluationWorkbenchRequestV1(input));
  if (new TextEncoder().encode(body).length > npAgentEvaluationWorkbenchRequestMaxBytesV1)
    throw new Error("Imported files and labels together must fit within 4 MiB.");
  const response = await npFetch("/api/admin/agents/evaluations", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body,
    signal,
  });
  if (!response.ok) throw await responseError(response);
  try {
    const result = npRequireAgentEvaluationWorkbenchResultV1(await response.json());
    if (result.recipe !== input.recipe) throw new Error("Recipe mismatch.");
    return result;
  } catch {
    throw new AgentStudioApiError(
      "The evaluation response could not be validated.",
      502,
      "STUDIO_CONTRACT_ERROR",
    );
  }
}

export interface EvaluationReviewDraft {
  outcome: NpAgentEvaluationWorkbenchOutcomeV1 | "";
  reviewer: string;
  notes: string;
  editedProposal: string;
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
export function evaluationReviewDraft(
  entry: NpAgentEvaluationWorkbenchCaseV1,
): EvaluationReviewDraft {
  const label = object(entry.labelJson === null ? null : JSON.parse(entry.labelJson));
  const prediction = object(JSON.parse(entry.predictionJson));
  const proposal =
    label?.editedProposal ??
    prediction?.moderatorResponse ??
    prediction?.planProposal ??
    prediction?.proposal ??
    null;
  const outcome = label?.outcome ?? label?.label;
  return {
    outcome: entry.allowedOutcomes.find((value) => value === outcome) ?? "",
    reviewer: typeof label?.reviewer === "string" ? label.reviewer : "",
    notes: typeof label?.notes === "string" ? label.notes : "",
    editedProposal: JSON.stringify(proposal, null, 2),
  };
}

/** Replace only the selected exact case binding, preserving every other imported review. */
export function evaluationWorkbenchLabels(
  result: NpAgentEvaluationWorkbenchResultV1,
  entry: NpAgentEvaluationWorkbenchCaseV1,
  draft: EvaluationReviewDraft | null,
  reviewedAt = new Date().toISOString(),
): unknown[] {
  if (!result.cases.includes(entry) || entry.sourceHash !== result.sourceHash)
    throw new Error("Select a case from the current validated evaluation.");
  const imported: unknown = result.labelsJson === null ? [] : JSON.parse(result.labelsJson);
  if (!Array.isArray(imported)) throw new Error("Invalid imported review labels.");
  const labels: unknown[] = imported.filter((value: unknown) => {
    const label = object(value);
    return !(
      label?.caseId === entry.caseId &&
      label.caseHash === entry.caseHash &&
      label.predictionHash === entry.predictionHash &&
      label.sourceHash === entry.sourceHash
    );
  });
  if (draft === null) return labels;
  if (
    !entry.eligible ||
    !entry.predictionHash ||
    draft.outcome === "" ||
    !entry.allowedOutcomes.includes(draft.outcome)
  )
    throw new Error("Choose an allowed outcome for this eligible case.");
  if (!draft.reviewer.trim()) throw new Error("Enter a self-reported reviewer name.");
  const binding = {
    caseId: entry.caseId,
    caseHash: entry.caseHash,
    predictionHash: entry.predictionHash,
    sourceHash: entry.sourceHash,
    reviewer: draft.reviewer,
    reviewedAt,
    notes: draft.notes,
  };
  labels.push(
    result.recipe === "moderator"
      ? { ...binding, label: draft.outcome }
      : {
          ...binding,
          outcome: draft.outcome,
          editedProposal: draft.outcome === "edit" ? JSON.parse(draft.editedProposal) : null,
        },
  );
  return labels;
}

/** Every input change cancels the old generation; late responses cannot restore its artifacts. */
export class EvaluationWorkbenchRequests {
  private controller: AbortController | null = null;
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }
  begin(): AbortController {
    this.cancel();
    this.controller = new AbortController();
    return this.controller;
  }
  current(controller: AbortController): boolean {
    return this.controller === controller && !controller.signal.aborted;
  }
}

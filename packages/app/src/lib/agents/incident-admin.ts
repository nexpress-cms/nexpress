import { NpServiceUnavailableError, NpValidationError } from "@nexpress/core";
import {
  npRequireAgentIncidentGetInputV1,
  npRequireAgentIncidentListInputV1,
  npRequireAgentIncidentListOutputV1,
  npRequireAgentIncidentStudioDetailV1,
  npRequireAgentIncidentEvidenceV1,
  npRequireAgentIncidentNotificationsV1,
  npRequireAgentIncidentAssignmentV1,
  npRequireAgentIncidentAssignmentInputV1,
  npRequireAgentIncidentFeedbackInputV1,
  npRequireAgentIncidentTransitionInputV1,
  npRequireAgentIncidentResponsePlanInputV1,
  npRequireAgentIncidentResponseExecuteInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
} from "@nexpress/core/agent-contract";
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";
import { npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { requireAgentStudioAdmin } from "./studio-admin";
import { agentStudioErrorResponse } from "./studio-error-response";
import { readAgentAdminJsonBody } from "./changeset-admin";

const invalid = () =>
  new NpValidationError("Invalid Incident request.", [
    { field: "request", message: "Use the bounded Incident request contract." },
  ]);

function query(request: NextRequest, detail: boolean) {
  if (request.nextUrl.search.length > 8192) throw invalid();
  const values: Record<string, unknown> = {
    statuses: [],
    categories: [],
    severities: [],
    updatedAfter: null,
    limit: 25,
    cursor: null,
  };
  const seen = new Set<string>();
  for (const [key, value] of request.nextUrl.searchParams) {
    if (seen.has(key) || !Object.hasOwn(values, key) || (detail && key !== "cursor"))
      throw invalid();
    seen.add(key);
    if (key === "limit") {
      if (!/^[1-9][0-9]{0,2}$/u.test(value)) throw invalid();
      values[key] = Number(value);
    } else if (["statuses", "categories", "severities"].includes(key)) {
      values[key] = value.split(",");
    } else values[key] = value;
  }
  try {
    return npRequireAgentIncidentListInputV1(values);
  } catch {
    throw invalid();
  }
}

/** HTTP decoding only; current visibility and mutation authority belong to the host service. */
export async function handleAgentIncidentAdminRequest(
  request: NextRequest,
  operation:
    | "list"
    | "notifications"
    | "detail"
    | "evidence"
    | "assignment"
    | "assign"
    | "feedback"
    | "transition"
    | "response-plan"
    | "response-execute"
    | "restore",
  id?: string,
): Promise<Response> {
  const mutation = !["list", "detail", "evidence", "assignment", "notifications"].includes(
    operation,
  );
  const headers = {
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  try {
    await ensureFor(mutation ? "write" : "read");
    const staff = await requireAgentStudioAdmin(request);
    const service = getOptionalAgentStudioServerRuntimeV1()?.incidents;
    if (!service) throw new NpServiceUnavailableError("Incident management is unavailable.");
    let result: unknown;
    if (operation === "notifications") {
      result = npRequireAgentIncidentNotificationsV1(
        await service.notifications({ ...staff, cursor: query(request, true).cursor }),
      );
    } else if (operation === "list") {
      const page = npRequireAgentIncidentListOutputV1(
        await service.list({ ...staff, query: query(request, false) }),
      );
      if (page.items.some((incident) => incident.siteId !== staff.siteId))
        throw new Error("Incident list response binding is invalid.");
      result = page;
    } else {
      let incidentId: string;
      try {
        incidentId = npRequireAgentIncidentGetInputV1({ incidentId: id }).incidentId;
      } catch {
        throw invalid();
      }
      if (operation === "assignment") {
        if (request.nextUrl.search) throw invalid();
        const assignment = npRequireAgentIncidentAssignmentV1(
          await service.assignment({ ...staff, incidentId }),
        );
        if (assignment.incidentId !== incidentId)
          throw new Error("Incident assignment response binding is invalid.");
        result = assignment;
      } else if (operation === "evidence") {
        const evidence = npRequireAgentIncidentEvidenceV1(
          await service.evidence({ ...staff, incidentId, cursor: query(request, true).cursor }),
        );
        if (evidence.incidentId !== incidentId)
          throw new Error("Incident evidence response binding is invalid.");
        result = evidence;
      } else if (operation === "detail") {
        const detail = npRequireAgentIncidentStudioDetailV1(
          await service.get({ ...staff, incidentId, cursor: query(request, true).cursor }),
        );
        if (detail.incident.id !== incidentId || detail.incident.siteId !== staff.siteId)
          throw new Error("Incident detail response binding is invalid.");
        result = detail;
      } else {
        if (request.nextUrl.search) throw invalid();
        let body: unknown;
        try {
          body = await readAgentAdminJsonBody(
            request,
            operation === "transition" || operation === "response-plan" ? 16384 : 4096,
          );
        } catch {
          throw invalid();
        }
        const decode = <T>(parser: (value: unknown) => T): T => {
          try {
            return parser(body);
          } catch {
            throw invalid();
          }
        };
        const dispatch = async () => {
          switch (operation) {
            case "assign":
              return service.assign({
                ...staff,
                incidentId,
                command: decode(npRequireAgentIncidentAssignmentInputV1),
              });
            case "transition":
              return service.transition({
                ...staff,
                incidentId,
                command: decode(npRequireAgentIncidentTransitionInputV1),
              });
            case "feedback":
              return service.feedback({
                ...staff,
                incidentId,
                command: decode(npRequireAgentIncidentFeedbackInputV1),
              });
            case "response-plan":
              return service.responsePlan({
                ...staff,
                incidentId,
                command: decode(npRequireAgentIncidentResponsePlanInputV1),
              });
            case "response-execute":
              return service.responseExecute({
                ...staff,
                incidentId,
                command: decode(npRequireAgentIncidentResponseExecuteInputV1),
              });
            case "restore":
              return service.restore({
                ...staff,
                incidentId,
                command: decode(npRequireAgentIncidentResponseExecuteInputV1),
              });
          }
        };
        const completed = await dispatch();
        if (completed.resourceId !== incidentId)
          throw new Error("Incident mutation response binding is invalid.");
        result = npRequireAgentRuntimeStudioMutationResultV1({
          resourceId: completed.resourceId,
          replayed: completed.replayed,
        });
      }
    }
    return npSuccessResponse(result, { headers });
  } catch (error) {
    return agentStudioErrorResponse(error, mutation ? "mutation" : "read", {
      headers,
    });
  }
}

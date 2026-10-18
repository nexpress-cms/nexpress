import { NpServiceUnavailableError, NpValidationError } from "@nexpress/core";
import {
  npRequireAgentIncidentGetInputV1,
  npRequireAgentGuardianResponseV1,
  npRequireAgentGuardianResponsePlanInputV1,
  npRequireAgentGuardianResponseExecuteInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
} from "@nexpress/core/agent-contract";
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";
import { npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { requireAgentStudioAdmin } from "./studio-admin";
import { agentStudioErrorResponse } from "./studio-error-response";
import { readAgentAdminJsonBody } from "./changeset-admin";

/** Exact HTTP decoding; optional host service owns current Incident, network target, policy and Approval authority. */
export async function handleAgentGuardianResponseAdminRequest(
  request: NextRequest,
  operation: "get" | "plan" | "execute",
  id: string,
): Promise<Response> {
  const headers = {
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  const invalid = () =>
    new NpValidationError("Invalid Guardian response request.", [
      {
        field: "request",
        message: "Use the bounded Guardian response contract without query parameters.",
      },
    ]);
  try {
    await ensureFor(operation === "get" ? "read" : "write");
    const staff = await requireAgentStudioAdmin(request);
    if (request.nextUrl.search) throw invalid();
    let incidentId: string;
    try {
      incidentId = npRequireAgentIncidentGetInputV1({ incidentId: id }).incidentId;
    } catch {
      throw invalid();
    }
    const service = getOptionalAgentStudioServerRuntimeV1()?.guardianResponses;
    if (!service)
      throw new NpServiceUnavailableError("Guardian response is disabled or unavailable.");
    if (operation === "get") {
      const result = npRequireAgentGuardianResponseV1(await service.get({ ...staff, incidentId }));
      if (result.incidentId !== incidentId)
        throw new Error("Guardian response binding is invalid.");
      return npSuccessResponse(result, { headers });
    }
    let body: unknown;
    try {
      body = await readAgentAdminJsonBody(request, 16384);
    } catch {
      throw invalid();
    }
    const command = (() => {
      try {
        return operation === "plan"
          ? npRequireAgentGuardianResponsePlanInputV1(body)
          : npRequireAgentGuardianResponseExecuteInputV1(body);
      } catch {
        throw invalid();
      }
    })();
    const result =
      operation === "plan"
        ? await service.plan({
            ...staff,
            incidentId,
            command: npRequireAgentGuardianResponsePlanInputV1(command),
          })
        : await service.execute({
            ...staff,
            incidentId,
            command: npRequireAgentGuardianResponseExecuteInputV1(command),
          });
    const acknowledgement = npRequireAgentRuntimeStudioMutationResultV1(result);
    if (
      operation === "execute" &&
      acknowledgement.resourceId !== npRequireAgentGuardianResponseExecuteInputV1(command).actionId
    )
      throw new Error("Guardian response acknowledgement is unbound.");
    return npSuccessResponse(acknowledgement, { headers });
  } catch (error) {
    return agentStudioErrorResponse(error, operation === "get" ? "read" : "mutation", { headers });
  }
}

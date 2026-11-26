import { NpServiceUnavailableError, NpValidationError } from "@nexpress/core";
import {
  npRequireAgentIncidentGetInputV1,
  npRequireAgentMemberResponseV1,
  npRequireAgentMemberResponsePlanInputV1,
  npRequireAgentMemberResponseExecuteInputV1,
  npRequireAgentRuntimeStudioMutationResultV1,
} from "@nexpress/core/agent-contract";
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";
import { npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { requireAgentStudioAdmin } from "./studio-admin";
import { agentStudioErrorResponse } from "./studio-error-response";
import { readAgentAdminJsonBody } from "./changeset-admin";

/** Exact HTTP decoding; optional host service owns current Incident, Member, policy and Approval authority. */
export async function handleAgentMemberResponseAdminRequest(
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
    new NpValidationError("Invalid Member response request.", [
      {
        field: "request",
        message: "Use the bounded Member response contract without query parameters.",
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
    const service = getOptionalAgentStudioServerRuntimeV1()?.memberResponses;
    if (!service)
      throw new NpServiceUnavailableError("Member response is disabled or unavailable.");
    if (operation === "get") {
      const result = npRequireAgentMemberResponseV1(await service.get({ ...staff, incidentId }));
      if (result.incidentId !== incidentId) throw new Error("Member response binding is invalid.");
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
          ? npRequireAgentMemberResponsePlanInputV1(body)
          : npRequireAgentMemberResponseExecuteInputV1(body);
      } catch {
        throw invalid();
      }
    })();
    const result =
      operation === "plan"
        ? await service.plan({
            ...staff,
            incidentId,
            command: npRequireAgentMemberResponsePlanInputV1(command),
          })
        : await service.execute({
            ...staff,
            incidentId,
            command: npRequireAgentMemberResponseExecuteInputV1(command),
          });
    const acknowledgement = npRequireAgentRuntimeStudioMutationResultV1(result);
    if (
      operation === "execute" &&
      acknowledgement.resourceId !== npRequireAgentMemberResponseExecuteInputV1(command).actionId
    )
      throw new Error("Member response acknowledgement is unbound.");
    return npSuccessResponse(acknowledgement, { headers });
  } catch (error) {
    return agentStudioErrorResponse(
      error,
      operation === "get" ? "read" : "mutation",
      { headers },
      request,
    );
  }
}

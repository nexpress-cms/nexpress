import { NpServiceUnavailableError, NpValidationError } from "@nexpress/core";
import {
  npAgentRuntimeAdminOperationIdsV1,
  npRequireAgentPolicySimulationReportV1,
  npRequireAgentRuntimeStudioQueryV1,
  npRequireAgentRuntimeStudioEffectiveQueryV1,
  npRequireAgentRuntimeStudioMutationResultV1,
  npRequireAgentRuntimeAdminInputV1,
  npRequireAgentRuntimeStudioConfigurationV1,
  npRequireAgentRuntimeStudioPolicyV1,
  npRequireAgentRuntimeStudioEffectiveV1,
  npRequireAgentRuntimeStudioCatalogV1,
  npRequireAgentRuntimeStudioBudgetV1,
  npRequireAgentRuntimeStudioOverviewV1,
  npAnalyzeAgentRuntimeStudioConfigurationsPageV1,
  npAnalyzeAgentRuntimeStudioPoliciesPageV1,
  npAnalyzeAgentRuntimeStudioTriggersPageV1,
  npRequireAgentContractResult,
  type NpAgentRuntimeAdminOperationIdV1,
  type NpAgentRuntimeStudioKindV1,
} from "@nexpress/core/agent-contract";
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";
import { npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { agentStudioErrorResponse } from "./studio-error-response";
import { requireAgentStudioAdmin } from "./studio-admin";
import { readAgentAdminJsonBody } from "./changeset-admin";

type Read =
  | NpAgentRuntimeStudioKindV1
  | "configuration"
  | "policy"
  | "effective"
  | "catalog"
  | "budget"
  | "status";
const mutationIds = new Set<string>(npAgentRuntimeAdminOperationIdsV1);
const invalid = () =>
  new NpValidationError("Invalid Runtime request.", [
    { field: "request", message: "Use the bounded Runtime request contract." },
  ]);
const readOutputs: Record<Read, (value: unknown) => unknown> = {
  configurations: (value) =>
    npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioConfigurationsPageV1(value)),
  policies: (value) =>
    npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioPoliciesPageV1(value)),
  triggers: (value) =>
    npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioTriggersPageV1(value)),
  configuration: npRequireAgentRuntimeStudioConfigurationV1,
  policy: npRequireAgentRuntimeStudioPolicyV1,
  effective: npRequireAgentRuntimeStudioEffectiveV1,
  catalog: npRequireAgentRuntimeStudioCatalogV1,
  budget: npRequireAgentRuntimeStudioBudgetV1,
  status: npRequireAgentRuntimeStudioOverviewV1,
};
function query(request: NextRequest, kind: NpAgentRuntimeStudioKindV1 | "effective") {
  if (request.nextUrl.search.length > 8192) throw invalid();
  const values: Record<string, unknown> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (Object.hasOwn(values, key)) throw invalid();
    if (key === "limit") {
      if (!/^[1-9][0-9]{0,2}$/u.test(value)) throw invalid();
      values[key] = Number(value);
    } else Object.defineProperty(values, key, { value, enumerable: true });
  }
  try {
    return kind === "effective"
      ? npRequireAgentRuntimeStudioEffectiveQueryV1(values)
      : npRequireAgentRuntimeStudioQueryV1(kind, values);
  } catch {
    throw invalid();
  }
}

/** Decode HTTP only. All authority and state changes remain in the shared services. */
export async function handleAgentRuntimeAdminRequest(
  request: NextRequest,
  operation: Read | NpAgentRuntimeAdminOperationIdV1,
  id?: string,
): Promise<Response> {
  const headers = {
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  try {
    const mutation = mutationIds.has(operation);
    if (
      request.nextUrl.search &&
      !["configurations", "policies", "triggers", "effective"].includes(operation)
    )
      throw invalid();
    await ensureFor(mutation ? "write" : "read");
    const staff = await requireAgentStudioAdmin(request);
    const service = getOptionalAgentStudioServerRuntimeV1()?.runtimeStudio;
    if (!service) throw new NpServiceUnavailableError("Agent Runtime management is unavailable.");
    let result: unknown;
    switch (operation) {
      case "configurations":
        result = await service.listConfigurations({ ...staff, query: query(request, operation) });
        break;
      case "policies":
        result = await service.listPolicies({ ...staff, query: query(request, operation) });
        break;
      case "triggers":
        result = await service.listTriggers({ ...staff, query: query(request, operation) });
        break;
      case "configuration":
        if (!id) throw invalid();
        result = await service.getConfiguration({ ...staff, id });
        break;
      case "policy":
        if (!id) throw invalid();
        result = await service.getPolicy({ ...staff, id });
        break;
      case "effective": {
        if (!id) throw invalid();
        const parsed = npRequireAgentRuntimeStudioEffectiveQueryV1(query(request, "effective"));
        result = await service.getEffective({ ...staff, id, ...parsed });
        break;
      }
      case "catalog":
        result = await service.getCatalog(staff);
        break;
      case "budget":
        result = await service.getBudget(staff);
        break;
      case "status":
        result = await service.getStatus(staff);
        break;
      default: {
        if (!mutation) throw invalid();
        let command;
        try {
          command = npRequireAgentRuntimeAdminInputV1(
            operation,
            await readAgentAdminJsonBody(request, 1_048_576),
          );
        } catch {
          throw invalid();
        }
        const completed = await service.executeAdmin({
          ...staff,
          operationId: operation,
          targetId: id ?? null,
          command,
        });
        if (operation === "agents.policies.simulate") {
          const simulation = npRequireAgentRuntimeAdminInputV1(operation, command);
          const report = npRequireAgentPolicySimulationReportV1(completed.output);
          if (
            completed.resourceId !== id ||
            report.policyId !== id ||
            report.policyHash !== simulation.configHash ||
            report.fixtureHash !== simulation.fixtureHash
          )
            throw new Error("Runtime simulation response binding is invalid.");
          result = report;
        } else
          result = npRequireAgentRuntimeStudioMutationResultV1({
            resourceId: completed.resourceId,
            replayed: completed.replayed,
          });
      }
    }
    if (Object.hasOwn(readOutputs, operation)) result = readOutputs[operation as Read](result);
    return npSuccessResponse(result, {
      headers,
      status:
        operation === "agents.configurations.create" ||
        operation === "agents.policies.create" ||
        operation === "agents.configurations.run"
          ? 201
          : 200,
    });
  } catch (error) {
    return agentStudioErrorResponse(
      error,
      Object.hasOwn(readOutputs, operation) ? "read" : "mutation",
      { headers },
    );
  }
}

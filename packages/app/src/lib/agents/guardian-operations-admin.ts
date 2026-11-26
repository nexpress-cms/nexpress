import { NpServiceUnavailableError, NpValidationError } from "@nexpress/core";
import {
  npRequireAgentIncidentGetInputV1,
  npRequireAgentGuardianDiagnosticsV1,
  npRequireAgentGuardianIncidentExportV1,
} from "@nexpress/core/agent-contract";
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";
import { ensureFor } from "../init-core";
import { requireAgentStudioAdmin } from "./studio-admin";
import { agentStudioErrorResponse } from "./studio-error-response";

/** Current staff/site authority and fresh source verification remain with the installed owner. */
export async function handleGuardianOperationsAdminRequest(
  request: NextRequest,
  operation: "export" | "diagnostics",
  id?: string,
): Promise<Response> {
  const headers = {
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  const invalid = () =>
    new NpValidationError("Invalid Guardian operations request.", [
      { field: "request", message: "Use the current Incident version without extra parameters." },
    ]);
  try {
    await ensureFor("read");
    const staff = await requireAgentStudioAdmin(request);
    const service = getOptionalAgentStudioServerRuntimeV1()?.guardianOperations;
    if (!service) throw new NpServiceUnavailableError("Guardian operations are unavailable.");
    if (operation === "diagnostics") {
      if (request.nextUrl.search) throw invalid();
      const result = npRequireAgentGuardianDiagnosticsV1(await service.diagnostics(staff));
      if (result.siteId !== staff.siteId) throw invalid();
      return Response.json(result, { headers });
    }
    const params = [...request.nextUrl.searchParams];
    if (
      params.length !== 1 ||
      params[0][0] !== "version" ||
      !/^[1-9][0-9]{0,8}$/u.test(params[0][1])
    )
      throw invalid();
    const expectedVersion = Number(params[0][1]);
    let incidentId: string;
    try {
      incidentId = npRequireAgentIncidentGetInputV1({ incidentId: id }).incidentId;
    } catch {
      throw invalid();
    }
    const result = npRequireAgentGuardianIncidentExportV1(
      await service.exportIncident({
        ...staff,
        incidentId,
        expectedVersion,
      }),
    );
    if (
      result.incident.siteId !== staff.siteId ||
      result.incident.id !== incidentId ||
      result.incident.versionNumber !== expectedVersion
    )
      throw invalid();
    return Response.json(result, {
      headers: {
        ...headers,
        "content-disposition": `attachment; filename="guardian-incident-${incidentId}.json"`,
      },
    });
  } catch (error) {
    return agentStudioErrorResponse(error, "read", { headers }, request);
  }
}

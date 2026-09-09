import { NpValidationError } from "@nexpress/core";
import {
  npRequireAgentApprovalQueryV1,
  npRequireAgentApprovalPageV1,
  npRequireAgentApprovalDetailV1,
  npRequireAgentApprovalChallengeOutputV1,
  npRequireAgentApprovalChallengeRequestV1,
  npRequireAgentApprovalDecisionInputV1,
  npRequireAgentChangeSetRequestApprovalInputV1,
} from "@nexpress/core/agent-contract";
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import type { NextRequest } from "next/server";
import { npErrorResponse, npSuccessResponse } from "../api-response";
import { ensureFor } from "../init-core";
import { requireAgentOauthStaff, normalizeAgentStudioError } from "./studio-admin";
import { readAgentAdminJsonBody } from "./changeset-admin";

const invalid = () =>
  new NpValidationError("Invalid approval input.", [
    { field: "request", message: "Use the exact bounded approval contract." },
  ]);
export function readAgentApprovalQuery(request: NextRequest) {
  if (request.nextUrl.search.length > 8192) throw invalid();
  const values: Record<string, unknown> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (Object.hasOwn(values, key) || !value) throw invalid();
    let decoded: unknown = value;
    if (key === "limit") {
      if (!/^[1-9][0-9]{0,2}$/u.test(value)) throw invalid();
      decoded = Number(value);
    } else if (key === "state" && value === "all") decoded = null;
    Object.defineProperty(values, key, { value: decoded, enumerable: true });
  }
  try {
    return npRequireAgentApprovalQueryV1(values);
  } catch {
    throw invalid();
  }
}
export async function handleAgentApprovalAdminRequest(
  request: NextRequest,
  operation: "list" | "get" | "challenge" | "approve" | "reject" | "revoke" | "request",
  id?: string,
): Promise<Response> {
  const headers = {
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  try {
    if (
      operation !== "list" &&
      (!id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id))
    )
      return new Response("Not found", { status: 404, headers });
    if (operation !== "list" && request.nextUrl.search) throw invalid();
    await ensureFor(operation === "list" || operation === "get" ? "read" : "write");
    const staff = await requireAgentOauthStaff(request);
    const runtime = getOptionalAgentStudioServerRuntimeV1();
    if (!runtime?.approvals || (operation === "request" && !runtime.changesets))
      return new Response("Not found", { status: 404, headers });
    if (operation === "list")
      return npSuccessResponse(
        npRequireAgentApprovalPageV1(
          await runtime.approvals.list({ ...staff, query: readAgentApprovalQuery(request) }),
        ),
        { headers },
      );
    if (operation === "get")
      return npSuccessResponse(
        npRequireAgentApprovalDetailV1(await runtime.approvals.get({ ...staff, id: id! })),
        { headers },
      );
    const raw = await readAgentAdminJsonBody(request, 16384);
    let command;
    try {
      command =
        operation === "challenge"
          ? npRequireAgentApprovalChallengeRequestV1(raw)
          : operation === "request"
            ? npRequireAgentChangeSetRequestApprovalInputV1(raw)
            : npRequireAgentApprovalDecisionInputV1(raw);
    } catch {
      throw invalid();
    }
    if (operation === "challenge")
      return npSuccessResponse(
        npRequireAgentApprovalChallengeOutputV1(
          await runtime.approvals.issueChallenge({ ...staff, id: id!, command }),
        ),
        { headers },
      );
    if (operation === "request")
      return npSuccessResponse(
        npRequireAgentApprovalDetailV1(
          await runtime.changesets!.requestApproval({
            actor: { kind: "staff", ...staff },
            id: id!,
            command,
          }),
        ),
        { headers },
      );
    return npSuccessResponse(
      npRequireAgentApprovalDetailV1(
        await runtime.approvals.decide({ ...staff, id: id!, decision: operation, command }),
      ),
      { headers },
    );
  } catch (error) {
    return npErrorResponse(normalizeAgentStudioError(error), { headers });
  }
}

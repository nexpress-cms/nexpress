import type { NextRequest } from "next/server";
import { handleGuardianOperationsAdminRequest } from "../../../../../lib/agents/guardian-operations-admin";
export async function GET(request: NextRequest) {
  return handleGuardianOperationsAdminRequest(request, "diagnostics");
}
export const dynamic = "force-dynamic";

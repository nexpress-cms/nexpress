import type { NextRequest } from "next/server";
import { handleGuardianOperationsAdminRequest } from "../../../../../../lib/agents/guardian-operations-admin";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleGuardianOperationsAdminRequest(request, "export", (await context.params).id);
}
export const dynamic = "force-dynamic";

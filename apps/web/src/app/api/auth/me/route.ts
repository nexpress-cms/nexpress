import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    return npSuccessResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

import type { NextRequest } from "next/server";

import { optionalAuth } from "@/lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const user = await optionalAuth(request);
    if (!user) {
      return npErrorResponse(
        Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED", statusCode: 401 }),
      );
    }
    return npSuccessResponse({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

import { createHash, randomUUID } from "node:crypto";

import { npRecordContentView } from "@nexpress/core/community";
import { npRequireEngagementTarget } from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { npRequireCommunityRequest } from "../../lib/community-contract";
import { ensureFor } from "../../lib/init-core";

const VISITOR_COOKIE = "np-visitor";
const VISITOR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VISITOR_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Records at most one public document view per opaque browser visitor and
 * target per UTC day. The raw first-party visitor id never reaches storage;
 * Core receives only its SHA-256 digest.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const target = npRequireCommunityRequest(
      npRequireEngagementTarget,
      await readJsonBody(request),
    );
    const candidate = request.cookies.get(VISITOR_COOKIE)?.value;
    const visitorId = candidate && VISITOR_PATTERN.test(candidate) ? candidate : randomUUID();
    const viewerHash = createHash("sha256").update(visitorId).digest("hex");
    const receipt = await npRecordContentView({ ...target, viewerHash });
    const response = npSuccessResponse(receipt);

    if (candidate !== visitorId) {
      response.cookies.set({
        name: VISITOR_COOKIE,
        value: visitorId,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: VISITOR_MAX_AGE_SECONDS,
      });
    }
    return response;
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

import { NpNotFoundError, NpValidationError } from "@nexpress/core";
import { getMemberProfile, listMemberProfileActivity } from "@nexpress/core/community";
import {
  npCommunityContractLimits,
  npRequireMemberProfileActivityQuery,
} from "@nexpress/core/community-contract";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { ensureFor } from "../../../../lib/init-core";

function validateQueryKeys(request: NextRequest): void {
  const allowed = new Set(["kind", "page", "limit"]);
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new NpValidationError("Invalid member activity query", [
        { field: key, message: "Unsupported query parameter." },
      ]);
    }
  }
}

function oneQueryValue(request: NextRequest, name: string): string | null {
  const values = request.nextUrl.searchParams.getAll(name);
  if (values.length > 1) {
    throw new NpValidationError("Invalid member activity query", [
      { field: name, message: "Must be provided at most once." },
    ]);
  }
  return values[0] ?? null;
}

function positiveQueryInteger(value: string | null, fallback: number, field: string): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new NpValidationError("Invalid member activity query", [
      { field, message: "Must be a canonical positive integer." },
    ]);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 10_000) {
    throw new NpValidationError("Invalid member activity query", [
      { field, message: "Must not exceed 10000." },
    ]);
  }
  return parsed;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    validateQueryKeys(request);
    const rawKind = oneQueryValue(request, "kind") ?? "documents";
    if (rawKind !== "documents" && rawKind !== "comments") {
      throw new NpValidationError("Invalid member activity query", [
        { field: "kind", message: "Must be documents or comments." },
      ]);
    }
    const limit = positiveQueryInteger(oneQueryValue(request, "limit"), 20, "limit");
    if (limit > npCommunityContractLimits.profileActivityPageRows) {
      throw new NpValidationError("Invalid member activity query", [
        { field: "limit", message: "Exceeds the public profile activity limit." },
      ]);
    }
    const query = npRequireMemberProfileActivityQuery({
      kind: rawKind,
      page: positiveQueryInteger(oneQueryValue(request, "page"), 1, "page"),
      limit,
    });
    await ensureFor("read");
    const { handle } = await params;
    const member = await getMemberProfile(handle);
    if (!member) throw new NpNotFoundError("member", handle);
    return npSuccessResponse(await listMemberProfileActivity(member.id, query));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

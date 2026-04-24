import { searchCollections } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureCoreServices } from "@/lib/init-core";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    ensureCoreServices();

    const params = request.nextUrl.searchParams;
    const q = params.get("q")?.trim() ?? "";
    if (q.length === 0) {
      return nxSuccessResponse({ results: [], total: 0, perCollection: {} });
    }

    const collectionsParam = params.get("collections");
    const collections = collectionsParam
      ? collectionsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const limit = parsePositiveInt(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parsePositiveInt(params.get("offset"), 0, 10_000);

    const result = await searchCollections({ q, collections, limit, offset });
    return nxSuccessResponse(result);
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

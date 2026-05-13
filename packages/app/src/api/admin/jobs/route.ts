import {
  NpForbiddenError,
  getOptionalJobQueue,
  type NpJobState,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

const VALID_STATES: ReadonlyArray<NpJobState> = [
  "created",
  "active",
  "completed",
  "failed",
  "retry",
  "cancelled",
  "expired",
];

/**
 * Phase 13 — admin job list. Returns a unified view across
 * pgboss.job (active / pending / retry) and pgboss.archive
 * (completed / failed / expired). Admin-only because the
 * payloads can carry sensitive data.
 *
 * Query params:
 *   ?name=media.processImage  → filter to one queue
 *   ?state=failed             → filter to one state
 *   ?limit=50&offset=100      → pagination
 *
 * Returns 501 when no queue is wired (sites running without
 * pg-boss; the framework supports this via NP_ENABLE_JOBS=0)
 * or when the queue's adapter doesn't implement listJobs.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("jobs", "list");
    }
    const queue = getOptionalJobQueue();
    if (!queue || typeof queue.listJobs !== "function") {
      return npSuccessResponse({
        supported: false,
        jobs: [],
        total: 0,
      });
    }
    const params = request.nextUrl.searchParams;
    const name = params.get("name") ?? undefined;
    const stateRaw = params.get("state");
    const state =
      stateRaw && (VALID_STATES as readonly string[]).includes(stateRaw)
        ? (stateRaw as NpJobState)
        : undefined;
    const limit = parseIntParam(params.get("limit"), 50, 200);
    const offset = parseIntParam(params.get("offset"), 0, 100_000);
    // Phase 13.2 — `?since=ISO8601` filter for time-bounded
    // queries ("last 24 hours"). Invalid timestamps are
    // silently dropped — better to show all jobs than to
    // 400 a typo.
    const sinceRaw = params.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : null;
    const validSince =
      since && !Number.isNaN(since.getTime()) ? since : undefined;
    // Phase 20.4 — `?source=live|archive` partitions the result
    // by pg-boss table. Unrecognised values fall through to the
    // historical UNION behavior.
    const sourceRaw = params.get("source");
    const source =
      sourceRaw === "live" || sourceRaw === "archive" ? sourceRaw : undefined;

    const result = await queue.listJobs({
      ...(name ? { name } : {}),
      ...(state ? { state } : {}),
      ...(validSince ? { since: validSince } : {}),
      ...(source ? { source } : {}),
      limit,
      offset,
    });
    return npSuccessResponse({ supported: true, ...result });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

function parseIntParam(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

export const dynamic = "force-dynamic";

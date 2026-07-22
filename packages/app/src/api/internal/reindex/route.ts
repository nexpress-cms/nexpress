import {
  NpAuthError,
  NpConflictError,
  NpServiceUnavailableError,
  NpValidationError,
  getOptionalJobQueue,
} from "@nexpress/core";
import {
  NpSearchContractError,
  getSearchCollectionLabels,
  npParseSearchReindexQuery,
  npRequireSearchReindexEnqueueResponse,
  npSearchContractLimits,
  type NpSearchReindexEnqueueFailure,
  type NpSearchReindexEnqueuedJob,
} from "@nexpress/core/search";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";

/**
 * Bearer-token-protected search reindex trigger. Enqueues one durable,
 * independently retryable job per searchable collection after bulk imports,
 * migrations, or first-time adapter installation. Pass `?collection=<slug>`
 * to scope to one collection; omit to enqueue every searchable collection.
 *
 * Reuses NP_SCHEDULER_TOKEN — the same token guards all internal triggers.
 * Bundling under one secret avoids multiplying rotation surface.
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.NP_SCHEDULER_TOKEN;
    if (!expected) {
      // Misconfiguration on the operator side — distinguish from server
      // failure (500) so monitors can alert correctly.
      throw new NpServiceUnavailableError(
        "Internal trigger token not configured (set NP_SCHEDULER_TOKEN).",
      );
    }

    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!supplied || supplied !== expected) {
      throw new NpAuthError("Unauthorized");
    }

    const requested = npParseSearchReindexQuery(request.nextUrl.searchParams);
    await ensureFor("write");
    const labels = getSearchCollectionLabels(requested ? [requested] : undefined);
    const slugs = Object.keys(labels);
    if (slugs.length > npSearchContractLimits.collectionCount) {
      throw new NpSearchContractError("Invalid search reindex request", [
        {
          code: "max-items",
          path: "search.reindex.collections",
          message: `at most ${npSearchContractLimits.collectionCount.toString()} collections may be reindexed in one request.`,
        },
      ]);
    }
    if (slugs.length === 0) {
      throw new NpSearchContractError("Invalid search reindex request", [
        {
          code: "invalid-field",
          path: "search.reindex.collections",
          message: "at least one searchable collection must be registered.",
        },
      ]);
    }
    const queue = getOptionalJobQueue();
    if (!queue) {
      throw new NpServiceUnavailableError(
        "Job queue is not wired (NP_ENABLE_JOBS=0?). Cannot enqueue search reindex.",
      );
    }

    const enqueued: NpSearchReindexEnqueuedJob[] = [];
    const failures: NpSearchReindexEnqueueFailure[] = [];
    const failureErrors: unknown[] = [];
    for (const collection of slugs) {
      try {
        const id = await queue.enqueue("search:reindex", { collection });
        enqueued.push({ collection, id });
      } catch (error) {
        failures.push({ collection, message: safeFailureMessage(error) });
        failureErrors.push(error);
      }
    }
    if (enqueued.length === 0) {
      const firstError = failureErrors[0];
      if (failures.length === 1 && firstError instanceof NpConflictError) throw firstError;
      if (
        failureErrors.length > 0 &&
        failureErrors.every((error) => error instanceof NpConflictError)
      ) {
        throw new NpConflictError("Every requested search reindex is already queued or active.");
      }
      throw new NpServiceUnavailableError(
        `Search reindex jobs could not be enqueued: ${failures[0]?.message ?? "unknown failure"}`,
      );
    }

    const response = npRequireSearchReindexEnqueueResponse({
      requested: slugs.length,
      enqueued,
      failures,
    });
    return npSuccessResponse(response, { status: 202 });
  } catch (error) {
    if (error instanceof NpSearchContractError) {
      return npErrorResponse(
        new NpValidationError(
          "Invalid search reindex request",
          error.issues.map((entry) => ({ field: entry.path, message: entry.message })),
        ),
      );
    }
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function safeFailureMessage(error: unknown): string {
  let raw = "Unknown enqueue failure";
  try {
    raw = error instanceof Error ? error.message : String(error);
  } catch {
    // A custom queue can reject with a value whose string coercion throws.
  }

  let normalized = "";
  let pendingSpace = false;
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    const safeCharacter = code >= 0xd800 && code <= 0xdfff ? "�" : character;
    if (
      code < 0x20 ||
      code === 0x7f ||
      code === 0xfffe ||
      code === 0xffff ||
      /\s/u.test(character)
    ) {
      pendingSpace = normalized.length > 0;
      continue;
    }
    const separator = pendingSpace ? " " : "";
    if (
      normalized.length + separator.length + safeCharacter.length >
      npSearchContractLimits.reindexFailureMessageLength
    ) {
      break;
    }
    normalized += separator + safeCharacter;
    pendingSpace = false;
  }
  return normalized || "Unknown enqueue failure";
}

export const dynamic = "force-dynamic";

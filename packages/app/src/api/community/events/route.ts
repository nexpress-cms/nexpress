import {
  npListCommunityRealtimeEvents,
  npRequireReadableCommunityDocument,
  npResolveCommunityRealtimeCursor,
  npResolveDocumentCommunityTarget,
  type NpCommunityRealtimeCursor,
  type NpCommunityRealtimeServerSubscription,
} from "@nexpress/core/community";
import { npRequireCommunityRealtimeSubscription } from "@nexpress/core/community-contract";
import { NpServiceUnavailableError } from "@nexpress/core";
import { requireSiteId } from "@nexpress/core/sites";
import type { NextRequest } from "next/server";

import { ensureFor } from "../../../lib/init-core";
import { npErrorResponse } from "../../../lib/api-response";
import { npRequireCommunityRequest } from "../../../lib/community-contract";
import {
  NP_COMMUNITY_REALTIME_STREAM_BUFFER_BYTES,
  npAcquireCommunityRealtimeStream,
  npRecordCommunityRealtimeBackpressureClose,
  npRecordCommunityRealtimePollFailure,
} from "../../../lib/community-realtime-capacity";
import { optionalMember, requireMember } from "../../../lib/member-auth-helpers";

const STREAM_LIFETIME_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const RETRY_MS = 3_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function readSubscription(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope");
  const targetType = request.nextUrl.searchParams.get("targetType");
  const targetId = request.nextUrl.searchParams.get("targetId");
  return npRequireCommunityRequest(
    npRequireCommunityRealtimeSubscription,
    scope === "inbox" && targetType === null && targetId === null
      ? { scope: "inbox" }
      : {
          scope,
          targetType,
          targetId,
        },
  );
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, POLL_INTERVAL_MS);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function hasQueueCapacity(
  controller: ReadableStreamDefaultController<Uint8Array>,
  frame: Uint8Array,
): boolean {
  const desiredSize = controller.desiredSize;
  return desiredSize !== null && desiredSize >= frame.byteLength;
}

/**
 * Site-scoped SSE invalidations. The stream carries no content or member ids:
 * clients refetch the existing exact, audience-aware APIs after each event.
 * A short lifetime forces periodic re-authorization and works within bounded
 * serverless request durations; EventSource resumes with Last-Event-ID.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const requested = readSubscription(request);
    const siteId = await requireSiteId();
    let subscription: NpCommunityRealtimeServerSubscription;

    if (requested.scope === "inbox") {
      const member = await requireMember(request);
      subscription = { scope: "inbox", siteId, memberId: member.id };
    } else {
      const member = await optionalMember(request);
      const target = await npResolveDocumentCommunityTarget(
        requested.targetType,
        requested.targetId,
      );
      await npRequireReadableCommunityDocument(
        target.collection,
        target.document,
        member ? { kind: "member", memberId: member.id } : null,
      );
      subscription = { ...requested, siteId };
    }

    const admission = npAcquireCommunityRealtimeStream(siteId);
    if (!admission.accepted) {
      return npErrorResponse(
        new NpServiceUnavailableError(
          admission.reason === "site"
            ? "Community realtime capacity is full for this site"
            : "Community realtime capacity is full for this process",
        ),
        {
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": admission.retryAfterSeconds.toString(),
          },
        },
      );
    }
    const lease = admission.lease;
    const releaseLease = () => {
      request.signal.removeEventListener("abort", releaseLease);
      lease.release();
    };
    request.signal.addEventListener("abort", releaseLease, { once: true });
    if (request.signal.aborted) releaseLease();

    let cursor: NpCommunityRealtimeCursor;
    try {
      cursor = await npResolveCommunityRealtimeCursor(
        subscription,
        request.headers.get("last-event-id"),
      );
    } catch (error) {
      releaseLease();
      throw error;
    }
    const encoder = new TextEncoder();
    const startedAt = Date.now();
    let cancelled = false;
    const cancelController = new AbortController();
    const streamSignal = AbortSignal.any([request.signal, cancelController.signal]);
    const stream = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          const connected = encoder.encode(`retry: ${RETRY_MS.toString()}\n: connected\n\n`);
          if (!hasQueueCapacity(controller, connected)) {
            npRecordCommunityRealtimeBackpressureClose();
            releaseLease();
            controller.close();
            return;
          }
          controller.enqueue(connected);
          void pump(controller);
        },
        cancel() {
          cancelled = true;
          cancelController.abort();
          releaseLease();
        },
      },
      {
        highWaterMark: NP_COMMUNITY_REALTIME_STREAM_BUFFER_BYTES,
        size: (chunk) => chunk.byteLength,
      },
    );

    async function pump(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
      let errored = false;
      let heartbeatAt = Date.now() + HEARTBEAT_INTERVAL_MS;
      try {
        while (!cancelled && !streamSignal.aborted && Date.now() - startedAt < STREAM_LIFETIME_MS) {
          const page = await npListCommunityRealtimeEvents(subscription, cursor);
          for (const event of page.events) {
            if (cancelled || streamSignal.aborted) break;
            const frame = encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
            if (!hasQueueCapacity(controller, frame)) {
              npRecordCommunityRealtimeBackpressureClose();
              return;
            }
            controller.enqueue(frame);
          }
          if (cancelled || streamSignal.aborted) break;
          // Advance only after every event in the page reached the stream queue.
          // A pressure close therefore reconnects from the last delivered SSE id.
          cursor = page.cursor;
          if (Date.now() >= heartbeatAt) {
            const heartbeat = encoder.encode(`: heartbeat ${Date.now().toString()}\n\n`);
            if (!hasQueueCapacity(controller, heartbeat)) {
              npRecordCommunityRealtimeBackpressureClose();
              return;
            }
            controller.enqueue(heartbeat);
            heartbeatAt = Date.now() + HEARTBEAT_INTERVAL_MS;
          }
          await waitForPoll(streamSignal);
        }
      } catch (error) {
        if (!cancelled && !streamSignal.aborted) {
          npRecordCommunityRealtimePollFailure();
          errored = true;
          controller.error(error);
        }
      } finally {
        releaseLease();
        if (!cancelled && !errored) {
          try {
            controller.close();
          } catch {
            // A concurrent consumer cancellation already closed the controller.
          }
        }
      }
    }

    return new Response(stream, {
      headers: {
        "Cache-Control": "private, no-cache, no-store, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        Vary: "Cookie, Last-Event-ID",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

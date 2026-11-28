import { npAgentEvents } from "@nexpress/core";
import {
  npAgentModeratorWindowStartedAtV1,
  type NpAgentModeratorCombinedCommentCollectorV1,
} from "@nexpress/core/agents";
import { recordJobLog } from "@nexpress/core/jobs";
import { requireSiteId } from "@nexpress/core/sites";
import type { NpDb } from "@nexpress/next";
import { definePlugin } from "@nexpress/plugin-sdk";
import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

export const communityPilotSchedulePluginId = "community-pilot-moderation";
export const communityPilotScheduleTaskId = "collect-closed-report-windows";
export const communityPilotWindowMs = 600_000;
export const communityPilotCollectionLog = "Community report window collected";
export const communityPilotUnchangedLog = "Community report window already collected";
const replayWindowCount = 6;

function checkpointKey(windowStartedAt: string): string {
  const bucket = Date.parse(windowStartedAt) / communityPilotWindowMs;
  return `closed-window:v1:${bucket % replayWindowCount}`;
}

export function createCommunityPilotModerationSchedule(options: {
  siteId: string;
  staffUserId: string;
  getDb: () => NpDb;
  collect: (
    windowStartedAt: string,
  ) => ReturnType<NpAgentModeratorCombinedCommentCollectorV1["collect"]>;
}) {
  return definePlugin({
    manifest: {
      id: communityPilotSchedulePluginId,
      version: "0.1.0",
      name: "Community pilot moderation",
      description: "Collects closed comment report windows for the isolated community pilot.",
      author: { name: "NexPress" },
      license: "MIT",
      capabilities: ["storage:kv"],
      nexpress: { minVersion: "0.4.7" },
    },
    scheduled: [
      {
        id: communityPilotScheduleTaskId,
        cron: "* * * * *",
        async handler(ctx) {
          const siteId = await requireSiteId();
          if (siteId !== options.siteId) return;

          const openWindow = new Date(npAgentModeratorWindowStartedAtV1(new Date().toISOString()));
          const oldestWindow = new Date(
            openWindow.getTime() - replayWindowCount * communityPilotWindowMs,
          );
          const window = sql<string>`to_char(date_bin(interval '10 minutes', ${npAgentEvents.occurredAt},
            timestamptz '1970-01-01 00:00:00+00') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
          const report = and(
            eq(npAgentEvents.kind, "community.content.reported"),
            eq(npAgentEvents.sourceComponent, "community.comment-reports"),
          );
          const windows = await options
            .getDb()
            .select({
              windowStartedAt: window,
              sourceDigest: sql<string>`encode(sha256(convert_to(${options.staffUserId}::text || ':' ||
                string_agg(${npAgentEvents.id}::text || ':' || ${npAgentEvents.eventHash}, ','
                  order by ${npAgentEvents.id}), 'UTF8')), 'hex')`,
            })
            .from(npAgentEvents)
            .where(
              and(
                eq(npAgentEvents.siteId, siteId),
                eq(npAgentEvents.sourceKind, "community"),
                sql`${npAgentEvents.subject}->>'kind' = 'comment'`,
                sql`${npAgentEvents.subject}->>'collection' = 'forum-posts'`,
                or(
                  report,
                  and(
                    eq(npAgentEvents.sourceComponent, "community.comments"),
                    inArray(npAgentEvents.kind, [
                      "community.content.created",
                      "community.content.moderated",
                    ]),
                  ),
                ),
                gte(npAgentEvents.recordedAt, oldestWindow),
                gte(npAgentEvents.occurredAt, oldestWindow),
                lt(npAgentEvents.occurredAt, openWindow),
              ),
            )
            .groupBy(window)
            .having(sql`bool_or(${report})`)
            .orderBy(window)
            .limit(replayWindowCount);
          const failures: unknown[] = [];
          for (const { windowStartedAt, sourceDigest } of windows) {
            try {
              const key = checkpointKey(windowStartedAt);
              const checkpoint = await ctx.storage.get<{
                windowStartedAt: string;
                sourceDigest: string;
              }>(key);
              if (
                checkpoint?.windowStartedAt === windowStartedAt &&
                checkpoint.sourceDigest === sourceDigest
              ) {
                await recordJobLog("debug", communityPilotUnchangedLog, {
                  siteId,
                  windowStartedAt,
                  sourceDigest,
                });
                continue;
              }

              const result = await options.collect(windowStartedAt);
              const complete = result.complete !== false;
              // Store the digest read before collection so evidence arriving during this run stays eligible.
              if (complete) await ctx.storage.set(key, { windowStartedAt, sourceDigest });
              await recordJobLog("info", communityPilotCollectionLog, {
                siteId,
                windowStartedAt,
                acceptedFacts: result.acceptedFacts,
                complete,
                sourceDigest,
                observations: result.observations.map(({ incidentId, disposition }) => ({
                  incidentId,
                  disposition,
                })),
              });
            } catch (error) {
              failures.push(error);
              await recordJobLog("warn", "Community report window collection failed", {
                siteId,
                windowStartedAt,
              });
            }
          }
          if (failures.length)
            throw new AggregateError(failures, "Community report collection failed.");
        },
      },
    ],
  });
}

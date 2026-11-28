import { npAgentEvents } from "@nexpress/core";
import {
  npAgentModeratorWindowStartedAtV1,
  type NpAgentModeratorCombinedCommentCollectorV1,
} from "@nexpress/core/agents";
import { recordJobLog } from "@nexpress/core/jobs";
import { requireSiteId } from "@nexpress/core/sites";
import type { NpDb } from "@nexpress/next";
import { definePlugin } from "@nexpress/plugin-sdk";
import { and, eq, gte, lt, sql } from "drizzle-orm";

export const communityPilotSchedulePluginId = "community-pilot-moderation";
export const communityPilotScheduleTaskId = "collect-closed-report-windows";
export const communityPilotWindowMs = 600_000;
export const communityPilotCollectionLog = "Community report window collected";
const replayWindowCount = 6;

export function createCommunityPilotModerationSchedule(options: {
  siteId: string;
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
      capabilities: [],
      nexpress: { minVersion: "0.4.7" },
    },
    scheduled: [
      {
        id: communityPilotScheduleTaskId,
        cron: "* * * * *",
        async handler() {
          const siteId = await requireSiteId();
          if (siteId !== options.siteId) return;

          const openWindow = new Date(npAgentModeratorWindowStartedAtV1(new Date().toISOString()));
          const oldestWindow = new Date(
            openWindow.getTime() - replayWindowCount * communityPilotWindowMs,
          );
          const window = sql<string>`to_char(date_bin(interval '10 minutes', ${npAgentEvents.occurredAt},
            timestamptz '1970-01-01 00:00:00+00') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
          const windows = await options
            .getDb()
            .selectDistinct({ windowStartedAt: window })
            .from(npAgentEvents)
            .where(
              and(
                eq(npAgentEvents.siteId, siteId),
                eq(npAgentEvents.kind, "community.content.reported"),
                eq(npAgentEvents.sourceKind, "community"),
                eq(npAgentEvents.sourceComponent, "community.comment-reports"),
                sql`${npAgentEvents.subject}->>'collection' = 'forum-posts'`,
                gte(npAgentEvents.recordedAt, oldestWindow),
                gte(npAgentEvents.occurredAt, oldestWindow),
                lt(npAgentEvents.occurredAt, openWindow),
              ),
            )
            .orderBy(window)
            .limit(replayWindowCount);
          const failures: unknown[] = [];
          for (const { windowStartedAt } of windows) {
            try {
              const result = await options.collect(windowStartedAt);
              await recordJobLog("info", communityPilotCollectionLog, {
                siteId,
                windowStartedAt,
                acceptedFacts: result.acceptedFacts,
                complete: result.complete !== false,
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

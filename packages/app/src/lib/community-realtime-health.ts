import {
  NP_COMMUNITY_REALTIME_RETENTION_MS,
  type NpCommunityRealtimeOutboxStats,
} from "@nexpress/core/community";

export interface CommunityRealtimeHealthCheck {
  id: "community.realtime_retention";
  label: "Community realtime retention";
  state: "ok" | "warn" | "error";
  detail: string;
  hint?: string;
}

function requireCount(value: unknown, path: string): number {
  const normalized =
    typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || (normalized as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  return normalized as number;
}

function requireDate(value: unknown, path: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${path} must be a valid Date.`);
  }
  return value;
}

/** Project the shared Core outbox statistics into Doctor, Health, and ops state. */
export function evaluateCommunityRealtimeHealth(
  value: NpCommunityRealtimeOutboxStats,
  recentCleanupFailures = 0,
): CommunityRealtimeHealthCheck {
  const totalRows = requireCount(value.totalRows, "community.realtime.totalRows");
  const expiredRows = requireCount(value.expiredRows, "community.realtime.expiredRows");
  const cleanupFailures = requireCount(
    recentCleanupFailures,
    "community.realtime.recentCleanupFailures",
  );
  if (expiredRows > totalRows) {
    throw new Error("community.realtime.expiredRows cannot exceed totalRows.");
  }
  const cutoff = requireDate(value.cutoff, "community.realtime.cutoff");
  const oldestCreatedAt =
    value.oldestCreatedAt === null
      ? null
      : requireDate(value.oldestCreatedAt, "community.realtime.oldestCreatedAt");
  if ((totalRows === 0) !== (oldestCreatedAt === null)) {
    throw new Error(
      "community.realtime.oldestCreatedAt must be null exactly when the outbox is empty.",
    );
  }

  const retentionHours = NP_COMMUNITY_REALTIME_RETENTION_MS / (60 * 60 * 1_000);
  if (expiredRows > 0 || cleanupFailures > 0) {
    const backlog =
      expiredRows > 0
        ? `${expiredRows.toString()} expired of ${totalRows.toString()} row(s) · oldest ${oldestCreatedAt?.toISOString() ?? "unknown"}`
        : `${totalRows.toString()} retained row(s)`;
    const failures =
      cleanupFailures > 0
        ? ` · ${cleanupFailures.toString()} cleanup failure${cleanupFailures === 1 ? "" : "s"} in 24h`
        : "";
    return {
      id: "community.realtime_retention",
      label: "Community realtime retention",
      state: "warn",
      detail: `${backlog}${failures}`,
      hint:
        expiredRows > 0
          ? `The hourly system:communityRealtimePrune job has backlog past the ${retentionHours.toString()}-hour cutoff ${cutoff.toISOString()}. Check worker health and recent job failures.`
          : "The hourly system:communityRealtimePrune job failed recently. Check worker health and the latest job log before a retention backlog develops.",
    };
  }
  return {
    id: "community.realtime_retention",
    label: "Community realtime retention",
    state: "ok",
    detail:
      totalRows === 0
        ? `empty · ${retentionHours.toString()}-hour retention`
        : `${totalRows.toString()} retained row(s) · oldest ${oldestCreatedAt?.toISOString() ?? "unknown"}`,
  };
}

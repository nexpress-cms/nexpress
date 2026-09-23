import type { NpJobState } from "@nexpress/core/jobs-contract";

export type JobsStateTab = "pending" | "active" | "completed" | "failed" | "archive";

const STATE_BUCKETS: Record<JobsStateTab, NpJobState[]> = {
  pending: ["created", "retry"],
  active: ["active"],
  completed: ["completed"],
  failed: ["failed", "cancelled", "expired"],
  archive: ["completed", "failed", "cancelled", "expired"],
};

/** The adapter's archive source is retained terminal history, not a physical table. */
export function jobListUrls(
  tab: JobsStateTab,
  windowMode: "all" | "24h",
  queueName?: string,
  now = Date.now(),
): string[] {
  return STATE_BUCKETS[tab].map((state) => {
    const params = new URLSearchParams({
      state,
      limit: "100",
      source: tab === "pending" || tab === "active" ? "live" : "archive",
    });
    if (windowMode === "24h") {
      params.set("since", new Date(now - 24 * 60 * 60 * 1000).toISOString());
    }
    if (queueName) params.set("name", queueName);
    return `/api/admin/jobs?${params.toString()}`;
  });
}

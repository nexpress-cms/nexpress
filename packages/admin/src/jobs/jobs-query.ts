import { npRequireJobQueueName, type NpJobState } from "@nexpress/core/jobs-contract";

export type JobsStateTab = "pending" | "active" | "completed" | "failed" | "archive";

export const JOB_STATE_BUCKETS: Record<JobsStateTab, NpJobState[]> = {
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
  page?: { state: NpJobState; offset: number },
): string[] {
  const states = JOB_STATE_BUCKETS[tab];
  if (
    page &&
    (!states.includes(page.state) ||
      !Number.isInteger(page.offset) ||
      page.offset < 0 ||
      page.offset > 100_000)
  ) {
    throw new Error("Invalid job page");
  }
  return (page ? [page.state] : states).map((state) => {
    const params = new URLSearchParams({
      state,
      limit: "100",
      source: tab === "pending" || tab === "active" ? "live" : "archive",
    });
    if (page) params.set("offset", String(page.offset));
    if (windowMode === "24h") {
      params.set("since", new Date(now - 24 * 60 * 60 * 1000).toISOString());
    }
    if (queueName) params.set("name", queueName);
    return `/api/admin/jobs?${params.toString()}`;
  });
}

export interface JobsLocation {
  queueName?: string;
  tab: JobsStateTab | "scheduled";
  state: NpJobState | "all";
  windowMode: "all" | "24h";
  offset: number;
  now: number;
}

/** Reject ambiguous links rather than silently broadening an investigation. */
export function parseJobsLocation(params: URLSearchParams): JobsLocation {
  const keys = ["name", "tab", "state", "window", "offset", "at"];
  for (const key of params.keys()) {
    if (!keys.includes(key) || params.getAll(key).length !== 1) {
      throw new Error("Invalid investigation link");
    }
  }
  const tab = params.get("tab") ?? "pending";
  if (tab !== "scheduled" && !Object.hasOwn(JOB_STATE_BUCKETS, tab)) {
    throw new Error("Invalid investigation tab");
  }
  const selectedTab = tab as JobsLocation["tab"];
  const states = selectedTab === "scheduled" ? [] : JOB_STATE_BUCKETS[selectedTab];
  const state = params.get("state") ?? (states.length === 1 ? states[0] : "all");
  if (state !== "all" && !states.some((entry) => entry === state)) {
    throw new Error("Invalid investigation state");
  }
  if (state === "all" && states.length === 1) {
    throw new Error("Invalid investigation state");
  }
  const windowMode = params.get("window") ?? "all";
  if (windowMode !== "all" && windowMode !== "24h") {
    throw new Error("Invalid investigation window");
  }
  const rawOffset = params.get("offset") ?? "0";
  const offset = Number(rawOffset);
  if (
    !/^(0|[1-9][0-9]*)$/u.test(rawOffset) ||
    offset > 100_000 ||
    offset % 100 !== 0 ||
    (offset > 0 && state === "all")
  ) {
    throw new Error("Invalid investigation page");
  }
  const at = params.get("at");
  const now = at === null ? 0 : Date.parse(at);
  if (
    (windowMode === "24h" &&
      (at === null ||
        !Number.isFinite(now) ||
        new Date(now).toISOString() !== at ||
        !Number.isFinite(new Date(now - 86_400_000).getTime()))) ||
    (windowMode === "all" && at !== null)
  ) {
    throw new Error("Invalid investigation time");
  }
  return {
    queueName: params.has("name") ? npRequireJobQueueName(params.get("name")) : undefined,
    tab: selectedTab,
    state: state as JobsLocation["state"],
    windowMode,
    offset,
    now,
  };
}

export function jobsLocationUrl(location: JobsLocation): string {
  const params = new URLSearchParams();
  if (location.queueName) params.set("name", location.queueName);
  if (location.tab !== "pending") params.set("tab", location.tab);
  const states = location.tab === "scheduled" ? [] : JOB_STATE_BUCKETS[location.tab];
  if (location.state !== "all" && states.length !== 1) params.set("state", location.state);
  if (location.windowMode === "24h") {
    params.set("window", "24h");
    params.set("at", new Date(location.now).toISOString());
  }
  if (location.offset !== 0) params.set("offset", String(location.offset));
  parseJobsLocation(params);
  const query = params.toString();
  return `/admin/jobs${query ? `?${query}` : ""}`;
}

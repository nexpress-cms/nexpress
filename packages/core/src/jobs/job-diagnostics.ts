import { countJobLogs, listJobLogs, type NpJobLogEntry } from "./job-log.js";
import type { NpJobListOptions, NpJobQueue, NpJobState, NpJobSummary } from "./queue.js";

export type NpRecentJobFailureState = Extract<
  NpJobState,
  "failed" | "expired" | "retry" | "cancelled"
>;

export interface NpRecentJobFailure {
  id: string;
  name: string;
  state: NpRecentJobFailureState;
  source?: "live" | "archive";
  retryCount?: number;
  output?: string | null;
  createdOn: string;
  startedOn?: string | null;
  completedOn?: string | null;
  logCount: number;
  lastLog: NpJobLogEntry | null;
  logError?: string;
}

export interface NpRecentJobFailuresOptions {
  /** Default 5, max 20. */
  limit?: number;
  /** Default failed + expired + retry. */
  states?: NpRecentJobFailureState[];
  since?: Date;
  source?: "live" | "archive";
  includeLogs?: boolean;
}

export interface NpRecentJobFailuresResult {
  supported: boolean;
  failures: NpRecentJobFailure[];
}

const DEFAULT_STATES: NpRecentJobFailureState[] = ["failed", "expired", "retry"];

export async function listRecentJobFailures(
  queue: NpJobQueue | null | undefined,
  options: NpRecentJobFailuresOptions = {},
): Promise<NpRecentJobFailuresResult> {
  if (!queue || typeof queue.listJobs !== "function") {
    return { supported: false, failures: [] };
  }

  const listJobs = (listOptions: NpJobListOptions) => queue.listJobs!(listOptions);
  const limit = Math.min(Math.max(1, options.limit ?? 5), 20);
  const states = options.states?.length ? options.states : DEFAULT_STATES;
  const results = await Promise.all(
    states.map((state) =>
      listJobs({
        state,
        limit,
        ...(options.since ? { since: options.since } : {}),
        ...(options.source ? { source: options.source } : {}),
      }),
    ),
  );
  const jobs = results
    .flatMap((result) => result?.jobs ?? [])
    .filter((job): job is NpJobSummary & { state: NpRecentJobFailureState } =>
      states.includes(job.state as NpRecentJobFailureState),
    )
    .sort((a, b) => sortTime(b) - sortTime(a))
    .slice(0, limit);

  const failures = await Promise.all(
    jobs.map(async (job) => {
      const log = options.includeLogs === false ? null : await readLatestLog(job.id);
      return {
        id: job.id,
        name: job.name,
        state: job.state,
        source: job.source,
        retryCount: job.retryCount,
        output: job.output,
        createdOn: job.createdOn,
        startedOn: job.startedOn,
        completedOn: job.completedOn,
        logCount: log?.count ?? 0,
        lastLog: log?.entry ?? null,
        ...(log?.error ? { logError: log.error } : {}),
      };
    }),
  );

  return { supported: true, failures };
}

function sortTime(job: NpJobSummary): number {
  const time = Date.parse(job.completedOn ?? job.startedOn ?? job.createdOn);
  return Number.isFinite(time) ? time : 0;
}

async function readLatestLog(
  jobId: string,
): Promise<{ count: number; entry: NpJobLogEntry | null; error?: string }> {
  try {
    const [entries, count] = await Promise.all([
      listJobLogs(jobId, { limit: 1, order: "desc" }),
      countJobLogs(jobId),
    ]);
    return { count, entry: entries[0] ?? null };
  } catch (error) {
    return {
      count: 0,
      entry: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

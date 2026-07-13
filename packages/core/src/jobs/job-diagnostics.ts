import {
  NP_JOB_FAILURE_STATES,
  npRequireJobListWire,
  npSerializeJobLogEntry,
  type NpJobFailureState,
  type NpJobLogEntry,
  type NpRecentJobFailure,
} from "../jobs-contract/index.js";
import { countJobLogs, listJobLogs } from "./job-log.js";
import type { NpJobListOptions, NpJobQueue, NpJobSummary } from "./queue.js";

export type NpRecentJobFailureState = NpJobFailureState;

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
  requireExactFailureOptions(options);
  if (!queue || typeof queue.listJobs !== "function") {
    return { supported: false, failures: [] };
  }

  const listJobs = (listOptions: NpJobListOptions) => queue.listJobs!(listOptions);
  const limit = options.limit ?? 5;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("job.failures.limit must be an integer between 1 and 20");
  }
  if (options.since !== undefined && !(options.since instanceof Date)) {
    throw new Error("job.failures.since must be a valid Date");
  }
  if (options.since && Number.isNaN(options.since.getTime())) {
    throw new Error("job.failures.since must be a valid Date");
  }
  if (options.source !== undefined && options.source !== "live" && options.source !== "archive") {
    throw new Error("job.failures.source must be live or archive");
  }
  if (options.includeLogs !== undefined && typeof options.includeLogs !== "boolean") {
    throw new Error("job.failures.includeLogs must be boolean");
  }
  const states =
    options.states === undefined ? DEFAULT_STATES : requireFailureStates(options.states);
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
    .flatMap(
      (result) =>
        npRequireJobListWire({ supported: true, jobs: result.jobs, total: result.total }).jobs,
    )
    .filter(
      (job): job is NpJobSummary & { state: NpRecentJobFailureState } =>
        (NP_JOB_FAILURE_STATES as readonly string[]).includes(job.state) &&
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
        lastLog: log?.entry ? npSerializeJobLogEntry(log.entry) : null,
        ...(log?.error ? { logError: log.error } : {}),
      };
    }),
  );

  return { supported: true, failures };
}

export type { NpRecentJobFailure } from "../jobs-contract/index.js";

function sortTime(job: NpJobSummary): number {
  return Date.parse(job.completedOn ?? job.startedOn ?? job.createdOn);
}

function requireFailureStates(value: unknown): NpRecentJobFailureState[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("job.failures.states must be a non-empty array");
  }
  const states = value.map((state) => {
    if (
      typeof state !== "string" ||
      !(NP_JOB_FAILURE_STATES as readonly string[]).includes(state)
    ) {
      throw new Error("job.failures.states must contain only failure states");
    }
    return state as NpRecentJobFailureState;
  });
  if (new Set(states).size !== states.length) {
    throw new Error("job.failures.states must not contain duplicates");
  }
  return states;
}

function requireExactFailureOptions(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("job.failures options must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("job.failures options must be a plain object");
  }
  const allowed = new Set(["limit", "states", "since", "source", "includeLogs"]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error("job.failures options must not contain symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`job.failures.${key} must be an enumerable plain data property`);
    }
    if (!allowed.has(key)) throw new Error(`job.failures.${key} is not supported`);
  }
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

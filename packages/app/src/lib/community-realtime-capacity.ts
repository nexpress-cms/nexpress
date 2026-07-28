export const NP_COMMUNITY_REALTIME_DEFAULT_MAX_STREAMS = 200;
export const NP_COMMUNITY_REALTIME_DEFAULT_MAX_SITE_STREAMS = 50;
export const NP_COMMUNITY_REALTIME_MAX_CONFIGURED_STREAMS = 10_000;
export const NP_COMMUNITY_REALTIME_RETRY_AFTER_SECONDS = 15;
export const NP_COMMUNITY_REALTIME_STREAM_BUFFER_BYTES = 64 * 1_024;

const NP_COMMUNITY_REALTIME_CAPACITY_STATE = Symbol.for("np.app.community-realtime-capacity.v1");
const NP_SITE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u;

type CommunityRealtimeCapacityEnv = Record<string, string | undefined>;

export interface CommunityRealtimeCapacityConfig {
  maxStreams: number;
  maxSiteStreams: number;
}

export interface CommunityRealtimeCapacitySnapshot extends CommunityRealtimeCapacityConfig {
  startedAt: string;
  activeStreams: number;
  activeSites: number;
  peakActiveStreams: number;
  admittedStreams: number;
  rejectedStreams: number;
  backpressureCloses: number;
  pollFailures: number;
}

export interface CommunityRealtimeCapacityContractCheck {
  id: "community.realtime_capacity";
  state: "ok" | "error";
  label: "Community realtime capacity";
  detail: string;
  hint?: string;
}

export interface CommunityRealtimeCapacityLease {
  release(): void;
}

export type CommunityRealtimeAdmission =
  | {
      accepted: true;
      lease: CommunityRealtimeCapacityLease;
    }
  | {
      accepted: false;
      reason: "process" | "site";
      retryAfterSeconds: number;
    };

interface CommunityRealtimeCapacityState {
  startedAt: string;
  activeStreams: number;
  peakActiveStreams: number;
  admittedStreams: number;
  rejectedStreams: number;
  backpressureCloses: number;
  pollFailures: number;
  activeBySite: Map<string, number>;
}

function createState(): CommunityRealtimeCapacityState {
  return {
    startedAt: new Date().toISOString(),
    activeStreams: 0,
    peakActiveStreams: 0,
    admittedStreams: 0,
    rejectedStreams: 0,
    backpressureCloses: 0,
    pollFailures: 0,
    activeBySite: new Map(),
  };
}

// Next may evaluate this source through more than one server entry chunk, and
// dev HMR re-evaluates modules. A symbol-keyed process store keeps admission
// atomic and Health counters shared across those copies.
function getState(): CommunityRealtimeCapacityState {
  const scope = globalThis as typeof globalThis & {
    [NP_COMMUNITY_REALTIME_CAPACITY_STATE]?: CommunityRealtimeCapacityState;
  };
  const existing = scope[NP_COMMUNITY_REALTIME_CAPACITY_STATE];
  if (existing) return existing;
  const created = createState();
  scope[NP_COMMUNITY_REALTIME_CAPACITY_STATE] = created;
  return created;
}

function increment(value: number): number {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : value;
}

function readPositiveInteger(
  env: CommunityRealtimeCapacityEnv,
  name: "NP_COMMUNITY_REALTIME_MAX_STREAMS" | "NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS",
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error(
      `${name} must be a canonical positive integer between 1 and ${NP_COMMUNITY_REALTIME_MAX_CONFIGURED_STREAMS.toString()}.`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > NP_COMMUNITY_REALTIME_MAX_CONFIGURED_STREAMS) {
    throw new Error(
      `${name} must be a canonical positive integer between 1 and ${NP_COMMUNITY_REALTIME_MAX_CONFIGURED_STREAMS.toString()}.`,
    );
  }
  return value;
}

/** Read the exact process-local SSE capacity contract without mutating runtime state. */
export function npReadCommunityRealtimeCapacityConfig(
  env: CommunityRealtimeCapacityEnv = process.env,
): CommunityRealtimeCapacityConfig {
  const maxStreams = readPositiveInteger(
    env,
    "NP_COMMUNITY_REALTIME_MAX_STREAMS",
    NP_COMMUNITY_REALTIME_DEFAULT_MAX_STREAMS,
  );
  const maxSiteStreams = readPositiveInteger(
    env,
    "NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS",
    NP_COMMUNITY_REALTIME_DEFAULT_MAX_SITE_STREAMS,
  );
  if (maxSiteStreams > maxStreams) {
    throw new Error(
      "NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS must be less than or equal to NP_COMMUNITY_REALTIME_MAX_STREAMS.",
    );
  }
  return { maxStreams, maxSiteStreams };
}

/** Shared pre-boot projection used byte-identically by Doctor and ops status. */
export function npCheckCommunityRealtimeCapacityConfig(
  env: CommunityRealtimeCapacityEnv = process.env,
): CommunityRealtimeCapacityContractCheck {
  try {
    const config = npReadCommunityRealtimeCapacityConfig(env);
    return {
      id: "community.realtime_capacity",
      state: "ok",
      label: "Community realtime capacity",
      detail: `${config.maxStreams.toString()} process stream(s) · ${config.maxSiteStreams.toString()} per site`,
    };
  } catch (error) {
    return {
      id: "community.realtime_capacity",
      state: "error",
      label: "Community realtime capacity",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Set canonical positive limits from 1 to 10000, with the per-site limit no greater than the process limit.",
    };
  }
}

/**
 * Atomically acquire one process-local stream slot. Authentication and site
 * resolution happen before this boundary so rejection cannot disclose tenants.
 */
export function npAcquireCommunityRealtimeStream(
  siteId: string,
  env: CommunityRealtimeCapacityEnv = process.env,
): CommunityRealtimeAdmission {
  if (typeof siteId !== "string" || !NP_SITE_ID_PATTERN.test(siteId)) {
    throw new Error("community realtime admission requires a canonical site id.");
  }
  const config = npReadCommunityRealtimeCapacityConfig(env);
  const state = getState();
  const siteActive = state.activeBySite.get(siteId) ?? 0;
  const reason =
    state.activeStreams >= config.maxStreams
      ? "process"
      : siteActive >= config.maxSiteStreams
        ? "site"
        : null;
  if (reason) {
    state.rejectedStreams = increment(state.rejectedStreams);
    return {
      accepted: false,
      reason,
      retryAfterSeconds: NP_COMMUNITY_REALTIME_RETRY_AFTER_SECONDS,
    };
  }

  state.activeStreams += 1;
  state.activeBySite.set(siteId, siteActive + 1);
  state.peakActiveStreams = Math.max(state.peakActiveStreams, state.activeStreams);
  state.admittedStreams = increment(state.admittedStreams);
  let released = false;
  return {
    accepted: true,
    lease: {
      release() {
        if (released) return;
        released = true;
        state.activeStreams = Math.max(0, state.activeStreams - 1);
        const active = state.activeBySite.get(siteId) ?? 0;
        if (active <= 1) state.activeBySite.delete(siteId);
        else state.activeBySite.set(siteId, active - 1);
      },
    },
  };
}

export function npRecordCommunityRealtimeBackpressureClose(): void {
  const state = getState();
  state.backpressureCloses = increment(state.backpressureCloses);
}

export function npRecordCommunityRealtimePollFailure(): void {
  const state = getState();
  state.pollFailures = increment(state.pollFailures);
}

export function npGetCommunityRealtimeCapacitySnapshot(
  env: CommunityRealtimeCapacityEnv = process.env,
): CommunityRealtimeCapacitySnapshot {
  const state = getState();
  return {
    ...npReadCommunityRealtimeCapacityConfig(env),
    startedAt: state.startedAt,
    activeStreams: state.activeStreams,
    activeSites: state.activeBySite.size,
    peakActiveStreams: state.peakActiveStreams,
    admittedStreams: state.admittedStreams,
    rejectedStreams: state.rejectedStreams,
    backpressureCloses: state.backpressureCloses,
    pollFailures: state.pollFailures,
  };
}

/** Internal test isolation; production callers must never reset live counters. */
export function npResetCommunityRealtimeCapacityForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Community realtime capacity may only be reset in tests.");
  }
  const scope = globalThis as typeof globalThis & {
    [NP_COMMUNITY_REALTIME_CAPACITY_STATE]?: CommunityRealtimeCapacityState;
  };
  scope[NP_COMMUNITY_REALTIME_CAPACITY_STATE] = createState();
}

export const NP_BUILTIN_JOB_TYPES = [
  "content:afterSave",
  "content:afterDelete",
  "search:reindex",
  "content:publishScheduled",
  "media:processImage",
  "media:cleanup",
  "plugin:scheduledTask",
  "plugin:scheduledTaskTick",
  "system:revisionPrune",
  "system:sessionCleanup",
  "system:jobLogPrune",
  "auth:sendPasswordReset",
  "members:sendVerifyEmail",
  "members:sendPasswordReset",
  "notifications:sendDigest",
  "import:wordpressApply",
] as const;

export const NP_JOB_STATES = [
  "created",
  "active",
  "completed",
  "failed",
  "retry",
  "cancelled",
  "expired",
] as const;

export const NP_JOB_FAILURE_STATES = ["failed", "expired", "retry", "cancelled"] as const;
export const NP_JOB_SOURCES = ["live", "archive"] as const;
export const NP_JOB_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const NP_WORKER_STATUSES = ["running", "stopped"] as const;

export type NpBuiltinJobType = (typeof NP_BUILTIN_JOB_TYPES)[number];

/**
 * Built-ins stay discoverable while application and plugin code may register
 * any canonical `namespace:action` name. The intersection preserves editor
 * completion for the built-in literals without closing the registry.
 */
export type NpJobType = NpBuiltinJobType | (string & {});

export type NpJobState = (typeof NP_JOB_STATES)[number];
export type NpJobFailureState = (typeof NP_JOB_FAILURE_STATES)[number];
export type NpJobSource = (typeof NP_JOB_SOURCES)[number];
export type NpJobLogLevel = (typeof NP_JOB_LOG_LEVELS)[number];
export type NpWorkerStatus = (typeof NP_WORKER_STATUSES)[number];

export type NpJobJsonPrimitive = string | number | boolean | null;
export type NpJobJsonValue =
  NpJobJsonPrimitive | NpJobJsonValue[] | { [key: string]: NpJobJsonValue };
export type NpJobData = Record<string, NpJobJsonValue>;
export type NpEmptyJobData = Record<string, never>;

export interface NpContentAfterSaveJobData {
  siteId: string;
  collection: string;
  documentId: string;
  operation: "create" | "update";
  userId: string | null;
  memberId: string | null;
}

export interface NpContentAfterDeleteJobData {
  siteId: string;
  collection: string;
  documentId: string;
  userId: string | null;
  memberId: string | null;
}

export interface NpMediaProcessImageJobData {
  siteId: string;
  mediaId: string;
}

export interface NpSearchReindexJobData {
  collection: string;
}

export interface NpPluginScheduledTaskJobData {
  siteId: string;
  pluginId: string;
  taskId: string;
}

/** Internal cron tick. The worker fans this out into durable site jobs. */
export interface NpPluginScheduledTaskTickJobData {
  pluginId: string;
  taskId: string;
}

export interface NpPasswordResetJobData {
  email: string;
  name: string;
  purpose: "invite" | "reset";
  resetUrl: string;
  expiresAt: string;
  siteName?: string;
}

export interface NpMemberEmailJobData {
  email: string;
  displayName: string;
  siteName?: string;
}

export interface NpMemberVerifyEmailJobData extends NpMemberEmailJobData {
  verifyUrl: string;
  expiresAt: string;
}

export interface NpMemberPasswordResetJobData extends NpMemberEmailJobData {
  resetUrl: string;
  expiresAt: string;
}

export interface NpNotificationDigestJobData {
  cadence: "daily" | "weekly";
  siteName?: string;
}

export interface NpWordPressImportApplyJobData {
  runId: string;
}

export interface NpBuiltinJobPayloadMap {
  "content:afterSave": NpContentAfterSaveJobData;
  "content:afterDelete": NpContentAfterDeleteJobData;
  "search:reindex": NpSearchReindexJobData;
  "content:publishScheduled": NpEmptyJobData;
  "media:processImage": NpMediaProcessImageJobData;
  "media:cleanup": NpEmptyJobData;
  "plugin:scheduledTask": NpPluginScheduledTaskJobData;
  "plugin:scheduledTaskTick": NpPluginScheduledTaskTickJobData;
  "system:revisionPrune": NpEmptyJobData;
  "system:sessionCleanup": NpEmptyJobData;
  "system:jobLogPrune": NpEmptyJobData;
  "auth:sendPasswordReset": NpPasswordResetJobData;
  "members:sendVerifyEmail": NpMemberVerifyEmailJobData;
  "members:sendPasswordReset": NpMemberPasswordResetJobData;
  "notifications:sendDigest": NpNotificationDigestJobData;
  "import:wordpressApply": NpWordPressImportApplyJobData;
}

export type NpJobPayload<TType extends NpJobType> = TType extends keyof NpBuiltinJobPayloadMap
  ? NpBuiltinJobPayloadMap[TType]
  : NpJobData;

export interface NpJobSummary {
  id: string;
  name: string;
  state: NpJobState;
  data: NpJobData;
  retryCount: number;
  output: string | null;
  createdOn: string;
  startedOn: string | null;
  completedOn: string | null;
  source: NpJobSource;
}

export interface NpJobListWire {
  supported: boolean;
  jobs: NpJobSummary[];
  total: number;
}

export interface NpJobStateCounts {
  created: number;
  active: number;
  completed: number;
  failed: number;
  retry: number;
  cancelled: number;
  expired: number;
}

export interface NpScheduleSummary {
  name: string;
  key: string;
  cron: string;
  timezone: string | null;
  data: NpJobData;
  createdOn: string;
  updatedOn: string | null;
}

export interface NpScheduleListWire {
  supported: boolean;
  schedules: NpScheduleSummary[];
  handlers: string[];
}

export interface NpJobsPauseState {
  paused: boolean;
  changedAt: string;
  changedByUserId: string | null;
  reason: string | null;
}

export interface NpWorkerHeartbeat {
  id: string;
  status: NpWorkerStatus;
  startedAt: Date;
  lastSeenAt: Date;
  meta: NpJobData;
}

export interface NpWorkerHealthWireEntry {
  id: string;
  status: NpWorkerStatus;
  startedAt: string;
  lastSeenAt: string;
  meta: NpJobData;
  alive: boolean;
  lastSeenAgoMs: number;
}

export interface NpJobLogEntry {
  id: string;
  jobId: string;
  level: NpJobLogLevel;
  message: string;
  context: NpJobData | null;
  createdAt: Date;
}

export interface NpJobLogInput {
  level: NpJobLogLevel;
  message: string;
  context: NpJobData | null;
}

export interface NpJobLogWireEntry {
  id: string;
  level: NpJobLogLevel;
  message: string;
  context: NpJobData | null;
  createdAt: string;
}

export interface NpJobLogsWire {
  jobId: string;
  total: number;
  entries: NpJobLogWireEntry[];
}

export interface NpRecentJobFailure {
  id: string;
  name: string;
  state: NpJobFailureState;
  source: NpJobSource;
  retryCount: number;
  output: string | null;
  createdOn: string;
  startedOn: string | null;
  completedOn: string | null;
  logCount: number;
  lastLog: NpJobLogWireEntry | null;
  logError?: string;
}

export interface NpJobsHealthWire {
  workers: NpWorkerHealthWireEntry[];
  aliveCount: number;
  totalCount: number;
  newestHeartbeat: string | null;
  pause: NpJobsPauseState;
  stuck: {
    counts: NpJobStateCounts;
    thresholds: { failed: number; expired: number };
  } | null;
  recentFailures: NpRecentJobFailure[];
}

export interface NpEnqueueJobWire {
  id: string;
  type: NpJobType;
  data: NpJobData;
}

export interface NpRetryJobWire {
  id: string;
}

export interface NpCancelJobWire {
  ok: true;
}

export interface NpRetryAllJobsWire {
  retried: number;
  failed: number;
  total: number;
  remaining: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}

export type NpPauseJobsWire = {
  paused: true;
  changedAt: string;
  reason: string | null;
  localApplied: boolean;
};

export type NpResumeJobsWire = {
  paused: false;
  changedAt: string;
  localApplied: boolean;
};

export interface NpJobContractIssue {
  path: string;
  message: string;
}

export type NpJobContractResult<T> =
  { ok: true; value: T } | { ok: false; issues: NpJobContractIssue[] };

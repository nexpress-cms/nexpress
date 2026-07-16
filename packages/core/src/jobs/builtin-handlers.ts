import { sendEmail } from "../email/service.js";
import { npInvalidateCache } from "../cache/runtime.js";
import { buildInviteEmail, buildMemberVerifyEmail, buildResetEmail } from "../email/templates.js";
import {
  type NpContentAfterDeleteJobData,
  type NpContentAfterSaveJobData,
  type NpJobData,
  type NpJobType,
  type NpMediaProcessImageJobData,
  type NpMemberPasswordResetJobData,
  type NpMemberVerifyEmailJobData,
  type NpNotificationDigestJobData,
  type NpPasswordResetJobData,
  type NpPluginScheduledTaskJobData,
} from "../jobs-contract/index.js";
import { registerJobHandler } from "./handlers.js";

type ContentJobData = NpContentAfterSaveJobData;
type ContentDeleteJobData = NpContentAfterDeleteJobData;

interface ResolvedContentContext {
  data: Record<string, unknown>;
}

interface BuiltinJobContext {
  resolveContentAfterSaveContext?: (
    data: ContentJobData,
  ) => Promise<ResolvedContentContext | null> | ResolvedContentContext | null;
  resolveContentAfterDeleteContext?: (
    data: ContentDeleteJobData,
  ) => Promise<ResolvedContentContext | null> | ResolvedContentContext | null;
  processImage?: (data: NpMediaProcessImageJobData) => Promise<void> | void;
  cleanupMedia?: (data: NpJobData) => Promise<void> | void;
  runScheduledPluginTask?: (data: NpPluginScheduledTaskJobData) => Promise<void> | void;
  pruneRevisions?: () => Promise<void> | void;
  cleanupSessions?: () => Promise<void> | void;
  revalidateCollection?: (
    collection: string,
    document?: Record<string, unknown> | null,
  ) => Promise<void> | void;
  revalidatePublishedDocuments?: (byCollection: Record<string, string[]>) => Promise<void> | void;
  sendPasswordReset?: (data: NpPasswordResetJobData) => Promise<void> | void;
  sendMemberVerifyEmail?: (data: NpMemberVerifyEmailJobData) => Promise<void> | void;
  sendMemberPasswordReset?: (data: NpMemberPasswordResetJobData) => Promise<void> | void;
}

const builtinJobContext: BuiltinJobContext = {};
const BUILTIN_JOB_CONTEXT_KEYS = new Set<keyof BuiltinJobContext>([
  "resolveContentAfterSaveContext",
  "resolveContentAfterDeleteContext",
  "processImage",
  "cleanupMedia",
  "runScheduledPluginTask",
  "pruneRevisions",
  "cleanupSessions",
  "revalidateCollection",
  "revalidatePublishedDocuments",
  "sendPasswordReset",
  "sendMemberVerifyEmail",
  "sendMemberPasswordReset",
]);

function resolveContentJobSiteId(
  data: NpContentAfterSaveJobData | NpContentAfterDeleteJobData,
): string {
  return data.siteId;
}

export function configureBuiltinJobContext(context: Partial<BuiltinJobContext>): void {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new Error("Built-in job context must be a plain object.");
  }
  const prototype = Object.getPrototypeOf(context) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Built-in job context must be a plain object.");
  }
  for (const key of Reflect.ownKeys(context)) {
    if (typeof key !== "string" || !BUILTIN_JOB_CONTEXT_KEYS.has(key as keyof BuiltinJobContext)) {
      throw new Error(`Unsupported built-in job context key "${String(key)}".`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(context, key);
    if (
      !descriptor?.enumerable ||
      !("value" in descriptor) ||
      (descriptor.value !== undefined && typeof descriptor.value !== "function")
    ) {
      throw new Error(`Built-in job context "${key}" must be a function or undefined.`);
    }
  }
  Object.assign(builtinJobContext, context);
}

export function registerBuiltinHandlers(): void {
  registerJobHandler("content:afterSave", handleContentAfterSave, {
    resolveSiteId: resolveContentJobSiteId,
  });
  registerJobHandler("content:afterDelete", handleContentAfterDelete, {
    resolveSiteId: resolveContentJobSiteId,
  });
  registerJobHandler("content:publishScheduled", handleContentPublishScheduled);
  registerJobHandler("media:processImage", handleMediaProcessImage);
  registerJobHandler("media:cleanup", handleMediaCleanup);
  registerJobHandler("plugin:scheduledTask", handlePluginScheduledTask);
  registerJobHandler("system:revisionPrune", handleRevisionPrune);
  registerJobHandler("system:sessionCleanup", handleSessionCleanup);
  registerJobHandler("system:jobLogPrune", handleJobLogPrune);
  registerJobHandler("auth:sendPasswordReset", handleAuthSendPasswordReset);
  registerJobHandler("members:sendVerifyEmail", handleMemberSendVerifyEmail);
  registerJobHandler("members:sendPasswordReset", handleMemberSendPasswordReset);
  registerJobHandler("notifications:sendDigest", handleNotificationsSendDigest);
}

async function handleContentPublishScheduled(_: NpJobData): Promise<void> {
  const { publishScheduledDocuments } = await import("../collections/scheduled.js");
  const result = await publishScheduledDocuments();
  await builtinJobContext.revalidatePublishedDocuments?.(result.byCollection);
  if (result.published > 0) {
    console.info(
      `[nexpress] content:publishScheduled flipped ${result.published} document(s)`,
      result.byCollection,
    );
  }
}

async function handleContentAfterSave(jobData: NpContentAfterSaveJobData): Promise<void> {
  let context: ResolvedContentContext | null | undefined;
  try {
    context = await builtinJobContext.resolveContentAfterSaveContext?.(jobData);
  } catch (error) {
    await revalidateContentJob(jobData);
    throw error;
  }
  await revalidateContentJob(jobData, context?.data);
}

async function handleContentAfterDelete(jobData: NpContentAfterDeleteJobData): Promise<void> {
  let context: ResolvedContentContext | null | undefined;
  try {
    context = await builtinJobContext.resolveContentAfterDeleteContext?.(jobData);
  } catch (error) {
    await revalidateContentJob(jobData);
    throw error;
  }
  await revalidateContentJob(jobData, context?.data);
}

async function handleMediaProcessImage(payload: NpMediaProcessImageJobData): Promise<void> {
  if (builtinJobContext.processImage) {
    await builtinJobContext.processImage(payload);
    return;
  }
  const { processMediaImage } = await import("../media/service.js");
  await processMediaImage(payload.mediaId, {});
}

async function handleMediaCleanup(data: NpJobData): Promise<void> {
  await builtinJobContext.cleanupMedia?.(data);
}

async function handlePluginScheduledTask(data: NpPluginScheduledTaskJobData): Promise<void> {
  // Phase 19 — first prefer the inline handler registered via
  // `definePlugin({ scheduled })`. Falls back to the legacy
  // `builtinJobContext.runScheduledPluginTask` resolver for
  // sites that wired their own dispatcher pre-Phase-19.
  try {
    const { runPluginScheduledTask } = await import("../plugins/host.js");
    await runPluginScheduledTask(data.pluginId, data.taskId);
    return;
  } catch (err) {
    // No registered schedule with this id — fall through to
    // the legacy resolver. If that's also absent we re-throw
    // so the worker's retry policy surfaces the misconfig.
    const message = err instanceof Error ? err.message : String(err);
    if (!/no scheduled task/.test(message) && !/is not registered/.test(message)) {
      throw err;
    }
    if (!builtinJobContext.runScheduledPluginTask) throw err;
  }
  await builtinJobContext.runScheduledPluginTask(data);
}

async function handleRevisionPrune(_: NpJobData): Promise<void> {
  await builtinJobContext.pruneRevisions?.();
}

async function handleSessionCleanup(_: NpJobData): Promise<void> {
  await builtinJobContext.cleanupSessions?.();
}

/**
 * Phase 20.3 — keep `np_job_logs` from growing unbounded.
 * Default retention is 14 days; the cron registration in
 * `pg-boss-adapter.scheduleRecurring()` runs this at 03:30 UTC
 * daily (offset from `system:revisionPrune` at 03:00 so the two
 * cleanup jobs don't pile DB load on the same minute).
 */
async function handleJobLogPrune(_: NpJobData): Promise<void> {
  const { pruneJobLogsOlderThan, DEFAULT_JOB_LOG_RETENTION_MS } = await import("./job-log.js");
  const cutoff = new Date(Date.now() - DEFAULT_JOB_LOG_RETENTION_MS);
  const deleted = await pruneJobLogsOlderThan(cutoff);
  if (deleted > 0) {
    console.info(`[nexpress] system:jobLogPrune deleted ${deleted} log row(s)`);
  }
}

/**
 * Default handler for password-reset / invite emails. Routes the message
 * through the configured email adapter (noop by default — see
 * `NoopEmailAdapter`). Apps override either by installing a real adapter
 * (`setEmailAdapter(new SmtpEmailAdapter(...))`) or by providing a fully
 * custom handler via `configureBuiltinJobContext({ sendPasswordReset })`.
 */
async function handleAuthSendPasswordReset(payload: NpPasswordResetJobData): Promise<void> {
  if (builtinJobContext.sendPasswordReset) {
    await builtinJobContext.sendPasswordReset(payload);
    return;
  }
  const templateData = {
    siteName: payload.siteName ?? "your site",
    name: payload.name,
    resetUrl: payload.resetUrl,
    expiresAt: payload.expiresAt,
  };
  const template =
    payload.purpose === "invite" ? buildInviteEmail(templateData) : buildResetEmail(templateData);

  await sendEmail({
    to: payload.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
}

async function revalidateContentJob(
  data: NpContentAfterSaveJobData | NpContentAfterDeleteJobData,
  document?: Record<string, unknown> | null,
): Promise<void> {
  if (builtinJobContext.revalidateCollection) {
    await builtinJobContext.revalidateCollection(data.collection, document);
    return;
  }
  await npInvalidateCache({
    source: "collection",
    collection: data.collection,
    siteId: data.siteId,
    tags: [
      `nx:${data.collection}`,
      `nx:${data.collection}:${data.documentId}`,
      `nx:collection:${data.collection}`,
    ],
  });
}

async function handleMemberSendVerifyEmail(payload: NpMemberVerifyEmailJobData): Promise<void> {
  if (builtinJobContext.sendMemberVerifyEmail) {
    await builtinJobContext.sendMemberVerifyEmail(payload);
    return;
  }
  const template = buildMemberVerifyEmail({
    siteName: payload.siteName ?? "your site",
    displayName: payload.displayName,
    verifyUrl: payload.verifyUrl,
    expiresAt: payload.expiresAt,
  });
  await sendEmail({
    to: payload.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
}

async function handleMemberSendPasswordReset(payload: NpMemberPasswordResetJobData): Promise<void> {
  if (builtinJobContext.sendMemberPasswordReset) {
    await builtinJobContext.sendMemberPasswordReset(payload);
    return;
  }
  // Reuse the staff `buildResetEmail` template — copy is identical from
  // the user's POV ("reset your <site> password"). When templating
  // diverges we'll fork the function, not the dispatcher.
  const template = buildResetEmail({
    siteName: payload.siteName ?? "your site",
    name: payload.displayName,
    resetUrl: payload.resetUrl,
    expiresAt: payload.expiresAt,
  });
  await sendEmail({
    to: payload.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
}

async function handleNotificationsSendDigest(data: NpNotificationDigestJobData): Promise<void> {
  const { cadence, siteName } = data;
  const { runDigestSweep } = await import("../community/digest.js");
  const result = await runDigestSweep({ cadence, siteName });

  console.info(
    `[nexpress] notifications:sendDigest cadence=${cadence}` +
      ` considered=${result.considered} sent=${result.sent}` +
      ` skipped=${result.skipped} failed=${result.failed}`,
  );
}

export type { BuiltinJobContext, ContentDeleteJobData, ContentJobData, NpJobType };

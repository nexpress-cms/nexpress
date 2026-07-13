import { type NpCollectionConfig, type NpCollectionHook } from "../config/types.js";
import type { NpAuthUser } from "../auth-contract/types.js";
import type { NpPrincipal as NpHookPrincipal } from "../auth/principal.js";
import { getEmailAdapter } from "../email/service.js";
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

interface ResolvedHookContext {
  collectionConfig: NpCollectionConfig;
  data: Record<string, unknown>;
  /**
   * Resolved staff session, or `null` when the originating actor
   * was a member (Phase 9.7o widened the hook surface so member
   * writes also fire `afterCreate` / `afterUpdate`).
   */
  user: NpAuthUser | null;
  /**
   * Polymorphic actor reference. Resolvers should derive this
   * from whatever actor metadata they recorded with the job —
   * e.g. by checking whether the saved `userId` is null
   * (member-authored) and looking up the member id separately.
   */
  principal: NpHookPrincipal;
  originalDoc?: Record<string, unknown> | null;
}

interface ResolvedDeleteHookContext {
  collectionConfig: NpCollectionConfig;
  data: Record<string, unknown>;
  user: NpAuthUser | null;
  principal: NpHookPrincipal;
}

interface BuiltinJobContext {
  resolveContentAfterSaveContext?: (
    data: ContentJobData,
  ) => Promise<ResolvedHookContext | null> | ResolvedHookContext | null;
  resolveContentAfterDeleteContext?: (
    data: ContentDeleteJobData,
  ) => Promise<ResolvedDeleteHookContext | null> | ResolvedDeleteHookContext | null;
  processImage?: (data: NpMediaProcessImageJobData) => Promise<void> | void;
  cleanupMedia?: (data: NpJobData) => Promise<void> | void;
  runScheduledPluginTask?: (data: NpPluginScheduledTaskJobData) => Promise<void> | void;
  pruneRevisions?: () => Promise<void> | void;
  cleanupSessions?: () => Promise<void> | void;
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
  if (result.published > 0) {
    console.info(
      `[nexpress] content:publishScheduled flipped ${result.published} document(s)`,
      result.byCollection,
    );
  }
}

async function handleContentAfterSave(jobData: NpContentAfterSaveJobData): Promise<void> {
  await revalidateCollectionTags(jobData.collection, jobData.documentId);

  const context = await builtinJobContext.resolveContentAfterSaveContext?.(jobData);

  if (!context) {
    return;
  }

  const hooks =
    jobData.operation === "create"
      ? context.collectionConfig.hooks?.afterCreate
      : context.collectionConfig.hooks?.afterUpdate;

  await runCollectionHooks(hooks, {
    data: context.data,
    user: context.user,
    principal: context.principal,
    collection: context.collectionConfig.slug,
    originalDoc: context.originalDoc,
  });
}

async function handleContentAfterDelete(jobData: NpContentAfterDeleteJobData): Promise<void> {
  await revalidateCollectionTags(jobData.collection, jobData.documentId);

  const context = await builtinJobContext.resolveContentAfterDeleteContext?.(jobData);

  if (!context) {
    return;
  }

  await runCollectionHooks(context.collectionConfig.hooks?.afterDelete, {
    data: context.data,
    user: context.user,
    principal: context.principal,
    collection: context.collectionConfig.slug,
  });
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
  };
  const template =
    payload.purpose === "invite" ? buildInviteEmail(templateData) : buildResetEmail(templateData);

  await getEmailAdapter().send({
    to: payload.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
}

async function runCollectionHooks(
  hooks: NpCollectionHook[] | undefined,
  args: Parameters<NpCollectionHook>[0],
): Promise<void> {
  if (!hooks || hooks.length === 0) {
    return;
  }

  for (const hook of hooks) {
    await hook(args);
  }
}

async function revalidateCollectionTags(collection: string, documentId: string): Promise<void> {
  try {
    const revalidateTag = await loadRevalidateTag();

    if (!revalidateTag) {
      return;
    }

    revalidateTag(`nx:${collection}`);
    revalidateTag(`nx:${collection}:${documentId}`);
  } catch {
    return;
  }
}

async function loadRevalidateTag(): Promise<((tag: string) => void) | null> {
  // Indirect specifier so TypeScript doesn't try to resolve
  // `next/cache` at compile time — `@nexpress/core` doesn't
  // depend on Next.js, the cache helpers are only available
  // when this code runs inside a Next runtime.
  const moduleId: string = "next/cache";
  let importedModule: unknown;
  try {
    importedModule = await import(moduleId);
  } catch {
    return null;
  }

  if (!isRecord(importedModule)) {
    return null;
  }

  const revalidateTag = importedModule.revalidateTag as
    ((tag: string) => void) | ((tag: string, profile: string) => void);

  if (typeof revalidateTag !== "function") {
    return null;
  }

  // Next 16 widened the signature to `(tag, profile)`. Detect
  // the runtime arity so this helper works against both 15.x
  // and 16.x without a hard pin: pre-16 ignores extra args.
  return (tag: string) => {
    if (revalidateTag.length >= 2) {
      revalidateTag(tag, "default");
    } else {
      (revalidateTag as (tag: string) => void)(tag);
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  });
  await getEmailAdapter().send({
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
  });
  await getEmailAdapter().send({
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

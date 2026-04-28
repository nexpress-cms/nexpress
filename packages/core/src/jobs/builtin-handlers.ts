import {
  type NxAuthUser,
  type NxCollectionConfig,
  type NxCollectionHook,
  type NxHookPrincipal,
  type NxJobType,
} from "../config/types.js";
import { getEmailAdapter } from "../email/service.js";
import { buildInviteEmail, buildMemberVerifyEmail, buildResetEmail } from "../email/templates.js";
import { registerJobHandler } from "./handlers.js";

interface ContentJobData {
  collection: string;
  documentId: string;
  operation: "create" | "update";
  userId: string;
}

interface ContentDeleteJobData {
  collection: string;
  documentId: string;
  userId: string;
}

interface ResolvedHookContext {
  collectionConfig: NxCollectionConfig;
  data: Record<string, unknown>;
  /**
   * Resolved staff session, or `null` when the originating actor
   * was a member (Phase 9.7o widened the hook surface so member
   * writes also fire `afterCreate` / `afterUpdate`).
   */
  user: NxAuthUser | null;
  /**
   * Polymorphic actor reference. Resolvers should derive this
   * from whatever actor metadata they recorded with the job —
   * e.g. by checking whether the saved `userId` is null
   * (member-authored) and looking up the member id separately.
   */
  principal: NxHookPrincipal;
  originalDoc?: Record<string, unknown> | null;
}

interface ResolvedDeleteHookContext {
  collectionConfig: NxCollectionConfig;
  data: Record<string, unknown>;
  user: NxAuthUser | null;
  principal: NxHookPrincipal;
}

interface BuiltinJobContext {
  resolveContentAfterSaveContext?: (
    data: ContentJobData,
  ) => Promise<ResolvedHookContext | null> | ResolvedHookContext | null;
  resolveContentAfterDeleteContext?: (
    data: ContentDeleteJobData,
  ) => Promise<ResolvedDeleteHookContext | null> | ResolvedDeleteHookContext | null;
  processImage?: (data: unknown) => Promise<void> | void;
  cleanupMedia?: (data: unknown) => Promise<void> | void;
  runScheduledPluginTask?: (data: unknown) => Promise<void> | void;
  pruneRevisions?: () => Promise<void> | void;
  cleanupSessions?: () => Promise<void> | void;
  sendPasswordReset?: (data: unknown) => Promise<void> | void;
  sendMemberVerifyEmail?: (data: unknown) => Promise<void> | void;
  sendMemberPasswordReset?: (data: unknown) => Promise<void> | void;
}

const builtinJobContext: BuiltinJobContext = {};

export function configureBuiltinJobContext(context: Partial<BuiltinJobContext>): void {
  Object.assign(builtinJobContext, context);
}

export function registerBuiltinHandlers(): void {
  registerJobHandler("content:afterSave", handleContentAfterSave);
  registerJobHandler("content:afterDelete", handleContentAfterDelete);
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

async function handleContentPublishScheduled(_: unknown): Promise<void> {
  const { publishScheduledDocuments } = await import("../collections/scheduled.js");
  const result = await publishScheduledDocuments();
  if (result.published > 0) {
    console.info(
      `[nexpress] content:publishScheduled flipped ${result.published} document(s)`,
      result.byCollection,
    );
  }
}

async function handleContentAfterSave(data: unknown): Promise<void> {
  const jobData = asContentJobData(data);

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

async function handleContentAfterDelete(data: unknown): Promise<void> {
  const jobData = asContentDeleteJobData(data);

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

async function handleMediaProcessImage(data: unknown): Promise<void> {
  await builtinJobContext.processImage?.(data);
}

async function handleMediaCleanup(data: unknown): Promise<void> {
  await builtinJobContext.cleanupMedia?.(data);
}

async function handlePluginScheduledTask(data: unknown): Promise<void> {
  // Phase 19 — first prefer the inline handler registered via
  // `definePlugin({ scheduled })`. Falls back to the legacy
  // `builtinJobContext.runScheduledPluginTask` resolver for
  // sites that wired their own dispatcher pre-Phase-19.
  if (isRecord(data) && typeof data.pluginId === "string" && typeof data.taskId === "string") {
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
    }
  }
  await builtinJobContext.runScheduledPluginTask?.(data);
}

async function handleRevisionPrune(_: unknown): Promise<void> {
  await builtinJobContext.pruneRevisions?.();
}

async function handleSessionCleanup(_: unknown): Promise<void> {
  await builtinJobContext.cleanupSessions?.();
}

/**
 * Phase 20.3 — keep `nx_job_logs` from growing unbounded.
 * Default retention is 14 days; the cron registration in
 * `pg-boss-adapter.scheduleRecurring()` runs this at 03:30 UTC
 * daily (offset from `system:revisionPrune` at 03:00 so the two
 * cleanup jobs don't pile DB load on the same minute).
 */
async function handleJobLogPrune(_: unknown): Promise<void> {
  const { pruneJobLogsOlderThan, DEFAULT_JOB_LOG_RETENTION_MS } = await import("./job-log.js");
  const cutoff = new Date(Date.now() - DEFAULT_JOB_LOG_RETENTION_MS);
  const deleted = await pruneJobLogsOlderThan(cutoff);
  if (deleted > 0) {
    console.info(`[nexpress] system:jobLogPrune deleted ${deleted} log row(s)`);
  }
}

interface PasswordResetJobData {
  email: string;
  name: string;
  token: string;
  purpose: "invite" | "reset";
  resetUrl: string;
  /** Optional — producer may pass a site-display name for the template. */
  siteName?: string;
}

/**
 * Default handler for password-reset / invite emails. Routes the message
 * through the configured email adapter (noop by default — see
 * `NoopEmailAdapter`). Apps override either by installing a real adapter
 * (`setEmailAdapter(new SmtpEmailAdapter(...))`) or by providing a fully
 * custom handler via `configureBuiltinJobContext({ sendPasswordReset })`.
 */
async function handleAuthSendPasswordReset(data: unknown): Promise<void> {
  if (builtinJobContext.sendPasswordReset) {
    await builtinJobContext.sendPasswordReset(data);
    return;
  }

  const payload = asPasswordResetJobData(data);
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

function asPasswordResetJobData(data: unknown): PasswordResetJobData {
  if (!isRecord(data)) {
    throw new Error("Invalid auth:sendPasswordReset job payload.");
  }

  return {
    email: asString(data.email, "email"),
    name: asString(data.name, "name"),
    token: asString(data.token, "token"),
    siteName:
      typeof data.siteName === "string" && data.siteName.length > 0 ? data.siteName : undefined,
    purpose: asResetPurpose(data.purpose),
    resetUrl: asString(data.resetUrl, "resetUrl"),
  };
}

function asResetPurpose(value: unknown): "invite" | "reset" {
  if (value === "invite" || value === "reset") {
    return value;
  }

  throw new Error("Invalid password reset purpose.");
}

async function runCollectionHooks(
  hooks: NxCollectionHook[] | undefined,
  args: Parameters<NxCollectionHook>[0],
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
    | ((tag: string) => void)
    | ((tag: string, profile: string) => void);

  if (typeof revalidateTag !== "function") {
    return null;
  }

  // Next 16 widened the signature to `(tag, profile)`. Detect
  // the runtime arity so this helper works against both 15.x
  // and 16.x without a hard pin: pre-16 ignores extra args.
  return (tag: string) => {
    if (revalidateTag.length >= 2) {
      (revalidateTag as (tag: string, profile: string) => void)(tag, "default");
    } else {
      (revalidateTag as (tag: string) => void)(tag);
    }
  };
}

function asContentJobData(data: unknown): ContentJobData {
  if (!isRecord(data)) {
    throw new Error("Invalid content:afterSave job payload.");
  }

  return {
    collection: asString(data.collection, "collection"),
    documentId: asString(data.documentId, "documentId"),
    operation: asContentOperation(data.operation),
    userId: asString(data.userId, "userId"),
  };
}

function asContentDeleteJobData(data: unknown): ContentDeleteJobData {
  if (!isRecord(data)) {
    throw new Error("Invalid content:afterDelete job payload.");
  }

  return {
    collection: asString(data.collection, "collection"),
    documentId: asString(data.documentId, "documentId"),
    userId: asString(data.userId, "userId"),
  };
}

function asContentOperation(value: unknown): ContentJobData["operation"] {
  if (value === "create" || value === "update") {
    return value;
  }

  throw new Error("Invalid content operation.");
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${fieldName} field.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface MemberVerifyJobData {
  email: string;
  displayName: string;
  verifyUrl: string;
  siteName?: string;
}

interface MemberResetJobData {
  email: string;
  displayName: string;
  resetUrl: string;
  siteName?: string;
}

async function handleMemberSendVerifyEmail(data: unknown): Promise<void> {
  if (builtinJobContext.sendMemberVerifyEmail) {
    await builtinJobContext.sendMemberVerifyEmail(data);
    return;
  }
  if (!isRecord(data)) throw new Error("Invalid members:sendVerifyEmail job payload.");
  const payload: MemberVerifyJobData = {
    email: asString(data.email, "email"),
    displayName: asString(data.displayName, "displayName"),
    verifyUrl: asString(data.verifyUrl, "verifyUrl"),
    siteName:
      typeof data.siteName === "string" && data.siteName.length > 0 ? data.siteName : undefined,
  };
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

async function handleMemberSendPasswordReset(data: unknown): Promise<void> {
  if (builtinJobContext.sendMemberPasswordReset) {
    await builtinJobContext.sendMemberPasswordReset(data);
    return;
  }
  if (!isRecord(data)) throw new Error("Invalid members:sendPasswordReset job payload.");
  const payload: MemberResetJobData = {
    email: asString(data.email, "email"),
    displayName: asString(data.displayName, "displayName"),
    resetUrl: asString(data.resetUrl, "resetUrl"),
    siteName:
      typeof data.siteName === "string" && data.siteName.length > 0 ? data.siteName : undefined,
  };
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

async function handleNotificationsSendDigest(data: unknown): Promise<void> {
  const cadence =
    isRecord(data) && (data.cadence === "daily" || data.cadence === "weekly")
      ? data.cadence
      : "daily";
  const siteName = isRecord(data) && typeof data.siteName === "string" ? data.siteName : undefined;
  const { runDigestSweep } = await import("../community/digest.js");
  const result = await runDigestSweep({ cadence, siteName });

  console.info(
    `[nexpress] notifications:sendDigest cadence=${cadence}` +
      ` considered=${result.considered} sent=${result.sent}` +
      ` skipped=${result.skipped} failed=${result.failed}`,
  );
}

export type { BuiltinJobContext, ContentDeleteJobData, ContentJobData, NxJobType };

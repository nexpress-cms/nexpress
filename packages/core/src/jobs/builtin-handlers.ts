import {
  type NxAuthUser,
  type NxCollectionConfig,
  type NxCollectionHook,
  type NxJobType,
} from "../config/types.js";
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
  user: NxAuthUser;
  originalDoc?: Record<string, unknown> | null;
}

interface ResolvedDeleteHookContext {
  collectionConfig: NxCollectionConfig;
  data: Record<string, unknown>;
  user: NxAuthUser;
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
}

const builtinJobContext: BuiltinJobContext = {};

export function configureBuiltinJobContext(context: Partial<BuiltinJobContext>): void {
  Object.assign(builtinJobContext, context);
}

export function registerBuiltinHandlers(): void {
  registerJobHandler("content:afterSave", handleContentAfterSave);
  registerJobHandler("content:afterDelete", handleContentAfterDelete);
  registerJobHandler("media:processImage", handleMediaProcessImage);
  registerJobHandler("media:cleanup", handleMediaCleanup);
  registerJobHandler("plugin:scheduledTask", handlePluginScheduledTask);
  registerJobHandler("system:revisionPrune", handleRevisionPrune);
  registerJobHandler("system:sessionCleanup", handleSessionCleanup);
  registerJobHandler("auth:sendPasswordReset", handleAuthSendPasswordReset);
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
  await builtinJobContext.runScheduledPluginTask?.(data);
}

async function handleRevisionPrune(_: unknown): Promise<void> {
  await builtinJobContext.pruneRevisions?.();
}

async function handleSessionCleanup(_: unknown): Promise<void> {
  await builtinJobContext.cleanupSessions?.();
}

interface PasswordResetJobData {
  email: string;
  name: string;
  token: string;
  purpose: "invite" | "reset";
  resetUrl: string;
}

/**
 * Default handler for password-reset / invite emails. Logs the reset URL
 * with a stub warning — real SMTP delivery is expected to replace this via
 * `registerJobHandler("auth:sendPasswordReset", yourHandler)` in the app.
 */
async function handleAuthSendPasswordReset(data: unknown): Promise<void> {
  if (builtinJobContext.sendPasswordReset) {
    await builtinJobContext.sendPasswordReset(data);
    return;
  }

  const payload = asPasswordResetJobData(data);
  const action = payload.purpose === "invite" ? "invite" : "reset";
  // eslint-disable-next-line no-console
  console.warn(
    `[nexpress] auth:sendPasswordReset is a stub — no mailer wired. ` +
      `Deliver this link to ${payload.email} (${payload.name}) [${action}]:\n  ${payload.resetUrl}`,
  );
}

function asPasswordResetJobData(data: unknown): PasswordResetJobData {
  if (!isRecord(data)) {
    throw new Error("Invalid auth:sendPasswordReset job payload.");
  }

  return {
    email: asString(data.email, "email"),
    name: asString(data.name, "name"),
    token: asString(data.token, "token"),
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
  const importedModule = await loadOptionalModule("next/cache");

  if (!isRecord(importedModule)) {
    return null;
  }

  const revalidateTag = importedModule.revalidateTag;

  if (typeof revalidateTag !== "function") {
    return null;
  }

  return (tag: string) => {
    revalidateTag(tag);
  };
}

async function loadOptionalModule(moduleId: string): Promise<unknown> {
  const importer = new Function(
    "moduleId",
    'return import(moduleId);',
  ) as (moduleId: string) => Promise<unknown>;

  return importer(moduleId);
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

export type { BuiltinJobContext, ContentDeleteJobData, ContentJobData, NxJobType };

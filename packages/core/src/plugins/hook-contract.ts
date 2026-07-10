import { type NpHookPrincipal } from "../config/types.js";

export const npPluginHookNames = [
  "content:beforeCreate",
  "content:afterCreate",
  "content:beforeUpdate",
  "content:afterUpdate",
  "content:beforeDelete",
  "content:afterDelete",
  "content:beforePublish",
  "content:afterPublish",
  "content:beforeUnpublish",
  "auth:afterLogin",
  "auth:beforeLogout",
  "auth:afterRegister",
  "render:beforePage",
  "media:beforeUpload",
  "media:afterUpload",
] as const;

export type NpPluginHookName = (typeof npPluginHookNames)[number];
export type NpPluginLifecycleHookName = Exclude<NpPluginHookName, "render:beforePage">;

export interface NpPluginUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
}

export interface NpPluginMember {
  readonly id: string;
  readonly email: string;
  readonly handle: string;
  readonly displayName: string;
}

export type NpPluginDocument = Record<string, unknown>;
export type NpReadonlyPluginDocument = Readonly<NpPluginDocument>;
export type NpContentHookSource = "request" | "scheduler";

interface NpContentHookDataBase<
  TOperation extends "create" | "update" | "delete",
  TDocumentId extends string | null,
  TDocument extends NpReadonlyPluginDocument,
  TOriginalDocument extends NpReadonlyPluginDocument | null,
  TSource extends NpContentHookSource,
  TPrincipal extends NpHookPrincipal | null,
> {
  readonly collection: string;
  readonly documentId: TDocumentId;
  readonly document: TDocument;
  readonly originalDocument: TOriginalDocument;
  readonly operation: TOperation;
  readonly source: TSource;
  readonly principal: TPrincipal;
}

type NpRequestContentHookData<
  TOperation extends "create" | "update" | "delete",
  TDocumentId extends string | null,
  TDocument extends NpReadonlyPluginDocument,
  TOriginalDocument extends NpReadonlyPluginDocument | null,
> = NpContentHookDataBase<
  TOperation,
  TDocumentId,
  TDocument,
  TOriginalDocument,
  "request",
  NpHookPrincipal
>;

type NpScheduledContentHookData = NpContentHookDataBase<
  "update",
  string,
  NpReadonlyPluginDocument,
  null,
  "scheduler",
  null
>;

export type NpContentBeforeCreateHookData = NpRequestContentHookData<
  "create",
  null,
  NpPluginDocument,
  null
>;
export type NpContentAfterCreateHookData = NpRequestContentHookData<
  "create",
  string,
  NpReadonlyPluginDocument,
  null
>;
export type NpContentBeforeUpdateHookData = NpRequestContentHookData<
  "update",
  string,
  NpPluginDocument,
  NpReadonlyPluginDocument
>;
export type NpContentAfterUpdateHookData =
  | NpRequestContentHookData<"update", string, NpReadonlyPluginDocument, NpReadonlyPluginDocument>
  | NpScheduledContentHookData;
export type NpContentBeforeDeleteHookData = NpRequestContentHookData<
  "delete",
  string,
  NpReadonlyPluginDocument,
  null
>;
export type NpContentAfterDeleteHookData = NpContentBeforeDeleteHookData;
export type NpContentBeforePublishHookData =
  | NpRequestContentHookData<"create", null, NpReadonlyPluginDocument, null>
  | NpRequestContentHookData<"update", string, NpReadonlyPluginDocument, NpReadonlyPluginDocument>;
export type NpContentAfterPublishHookData =
  | NpRequestContentHookData<"create", string, NpReadonlyPluginDocument, null>
  | NpRequestContentHookData<"update", string, NpReadonlyPluginDocument, NpReadonlyPluginDocument>
  | NpScheduledContentHookData;
export type NpContentBeforeUnpublishHookData = NpRequestContentHookData<
  "update",
  string,
  NpReadonlyPluginDocument,
  NpReadonlyPluginDocument
>;

export interface NpAuthAfterLoginHookData {
  readonly user: NpPluginUser;
}

export interface NpAuthBeforeLogoutHookData {
  readonly user: NpPluginUser;
}

export interface NpAuthAfterRegisterHookData {
  readonly user: NpPluginUser;
  readonly origin: "admin" | "invite";
}

export interface NpMediaUploadFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface NpMediaUploadResult {
  readonly id: string;
  readonly status: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly folderId: string | null;
}

type NpMediaHookActor =
  | { readonly principal: Extract<NpHookPrincipal, { kind: "staff" }>; readonly member: null }
  | {
      readonly principal: Extract<NpHookPrincipal, { kind: "member" }>;
      readonly member: NpPluginMember;
    };

export type NpMediaBeforeUploadHookData = NpMediaHookActor & {
  readonly file: NpMediaUploadFile;
  readonly folderId: string | null;
};

export type NpMediaAfterUploadHookData = NpMediaHookActor & {
  readonly media: NpMediaUploadResult;
};

export interface NpRenderHookData {
  readonly collection: string;
  readonly slug: string;
  readonly document: NpReadonlyPluginDocument;
}

export interface NpPluginHookDataMap {
  "content:beforeCreate": NpContentBeforeCreateHookData;
  "content:afterCreate": NpContentAfterCreateHookData;
  "content:beforeUpdate": NpContentBeforeUpdateHookData;
  "content:afterUpdate": NpContentAfterUpdateHookData;
  "content:beforeDelete": NpContentBeforeDeleteHookData;
  "content:afterDelete": NpContentAfterDeleteHookData;
  "content:beforePublish": NpContentBeforePublishHookData;
  "content:afterPublish": NpContentAfterPublishHookData;
  "content:beforeUnpublish": NpContentBeforeUnpublishHookData;
  "auth:afterLogin": NpAuthAfterLoginHookData;
  "auth:beforeLogout": NpAuthBeforeLogoutHookData;
  "auth:afterRegister": NpAuthAfterRegisterHookData;
  "render:beforePage": NpRenderHookData;
  "media:beforeUpload": NpMediaBeforeUploadHookData;
  "media:afterUpload": NpMediaAfterUploadHookData;
}

export type NpPluginHookData<TName extends NpPluginHookName> = NpPluginHookDataMap[TName];

export type NpPluginHookValidationResult = { ok: true } | { ok: false; message: string };

const pluginHookNameSet = new Set<string>(npPluginHookNames);

export function npIsPluginHookName(value: string): value is NpPluginHookName {
  return pluginHookNameSet.has(value);
}

function invalid(message: string): NpPluginHookValidationResult {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isPluginUser(value: unknown): value is NpPluginUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.role === "string"
  );
}

function isPrincipal(value: unknown): value is NpHookPrincipal {
  if (!isRecord(value)) return false;
  if (value.kind === "staff") return isPluginUser(value.user);
  return value.kind === "member" && typeof value.memberId === "string";
}

function isMember(value: unknown): value is NpPluginMember {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.handle === "string" &&
    typeof value.displayName === "string"
  );
}

function validateContentHookData(
  hookName: Extract<NpPluginHookName, `content:${string}`>,
  value: unknown,
): NpPluginHookValidationResult {
  const keys = [
    "collection",
    "documentId",
    "document",
    "originalDocument",
    "operation",
    "source",
    "principal",
  ];
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) {
    return invalid(`${hookName} data must contain only the canonical content hook fields.`);
  }
  if (typeof value.collection !== "string" || value.collection.length === 0) {
    return invalid(`${hookName} data.collection must be a non-empty string.`);
  }
  if (!isRecord(value.document)) {
    return invalid(`${hookName} data.document must be a plain object.`);
  }
  if (value.originalDocument !== null && !isRecord(value.originalDocument)) {
    return invalid(`${hookName} data.originalDocument must be a plain object or null.`);
  }
  if (value.documentId !== null && typeof value.documentId !== "string") {
    return invalid(`${hookName} data.documentId must be a string or null.`);
  }
  if (value.source !== "request" && value.source !== "scheduler") {
    return invalid(`${hookName} data.source must be request or scheduler.`);
  }
  if (value.principal !== null && !isPrincipal(value.principal)) {
    return invalid(`${hookName} data.principal must be a staff/member principal or null.`);
  }

  const requestActorValid = value.source === "request" && value.principal !== null;
  const schedulerActorValid = value.source === "scheduler" && value.principal === null;
  if (!requestActorValid && !schedulerActorValid) {
    return invalid(`${hookName} data.source and data.principal do not describe the same actor.`);
  }

  switch (hookName) {
    case "content:beforeCreate":
      return value.operation === "create" &&
        value.source === "request" &&
        value.documentId === null &&
        value.originalDocument === null
        ? { ok: true }
        : invalid(
            `${hookName} requires a request create draft without an id or original document.`,
          );
    case "content:afterCreate":
      return value.operation === "create" &&
        value.source === "request" &&
        typeof value.documentId === "string" &&
        value.originalDocument === null
        ? { ok: true }
        : invalid(`${hookName} requires a persisted request create document.`);
    case "content:beforeUpdate":
    case "content:beforeUnpublish":
      return value.operation === "update" &&
        value.source === "request" &&
        typeof value.documentId === "string" &&
        isRecord(value.originalDocument)
        ? { ok: true }
        : invalid(`${hookName} requires a request update with its original document.`);
    case "content:afterUpdate":
      if (value.operation !== "update" || typeof value.documentId !== "string") {
        return invalid(`${hookName} requires a persisted update document.`);
      }
      if (value.source === "scheduler") {
        return value.originalDocument === null
          ? { ok: true }
          : invalid(`${hookName} scheduler data must not invent an original document.`);
      }
      return isRecord(value.originalDocument)
        ? { ok: true }
        : invalid(`${hookName} request data requires its original document.`);
    case "content:beforeDelete":
    case "content:afterDelete":
      return value.operation === "delete" &&
        value.source === "request" &&
        typeof value.documentId === "string" &&
        value.originalDocument === null
        ? { ok: true }
        : invalid(`${hookName} requires a request delete document snapshot.`);
    case "content:beforePublish":
      if (value.source !== "request") {
        return invalid(`${hookName} is emitted only by request writes.`);
      }
      if (value.operation === "create") {
        return value.documentId === null && value.originalDocument === null
          ? { ok: true }
          : invalid(`${hookName} create data must not have an id or original document.`);
      }
      return value.operation === "update" &&
        typeof value.documentId === "string" &&
        isRecord(value.originalDocument)
        ? { ok: true }
        : invalid(`${hookName} update data requires an id and original document.`);
    case "content:afterPublish":
      if (value.operation !== "create" && value.operation !== "update") {
        return invalid(`${hookName} requires a create or update operation.`);
      }
      if (typeof value.documentId !== "string") {
        return invalid(`${hookName} requires a persisted document id.`);
      }
      if (value.source === "scheduler") {
        return value.operation === "update" && value.originalDocument === null
          ? { ok: true }
          : invalid(`${hookName} scheduler data must be an update without an original document.`);
      }
      if (value.operation === "create") {
        return value.originalDocument === null
          ? { ok: true }
          : invalid(`${hookName} create data must not have an original document.`);
      }
      return isRecord(value.originalDocument)
        ? { ok: true }
        : invalid(`${hookName} update data requires its original document.`);
  }
}

function validateAuthHookData(
  hookName: Extract<NpPluginHookName, `auth:${string}`>,
  value: unknown,
): NpPluginHookValidationResult {
  if (!isRecord(value) || !isPluginUser(value.user)) {
    return invalid(`${hookName} data.user must be a plugin user.`);
  }
  if (hookName === "auth:afterRegister") {
    return hasOnlyKeys(value, ["user", "origin"]) &&
      (value.origin === "admin" || value.origin === "invite")
      ? { ok: true }
      : invalid(`${hookName} data.origin must be admin or invite with no extra fields.`);
  }
  return hasOnlyKeys(value, ["user"])
    ? { ok: true }
    : invalid(`${hookName} data supports only user.`);
}

function validateMediaHookActor(
  hookName: Extract<NpPluginHookName, `media:${string}`>,
  principal: unknown,
  member: unknown,
): NpPluginHookValidationResult {
  if (!isPrincipal(principal)) {
    return invalid(`${hookName} data.principal must be a staff or member principal.`);
  }
  if (principal.kind === "staff") {
    return member === null ? { ok: true } : invalid(`${hookName} staff data.member must be null.`);
  }
  return isMember(member) && member.id === principal.memberId
    ? { ok: true }
    : invalid(`${hookName} member data must match the member principal.`);
}

function validateMediaHookData(
  hookName: Extract<NpPluginHookName, `media:${string}`>,
  value: unknown,
): NpPluginHookValidationResult {
  if (!isRecord(value)) return invalid(`${hookName} data must be a plain object.`);
  const actor = validateMediaHookActor(hookName, value.principal, value.member);
  if (!actor.ok) return actor;

  if (hookName === "media:beforeUpload") {
    if (!hasOnlyKeys(value, ["file", "folderId", "principal", "member"])) {
      return invalid(`${hookName} data contains unsupported fields.`);
    }
    if (value.folderId !== null && typeof value.folderId !== "string") {
      return invalid(`${hookName} data.folderId must be a string or null.`);
    }
    const file = value.file;
    return isRecord(file) &&
      hasOnlyKeys(file, ["filename", "mimeType", "size"]) &&
      typeof file.filename === "string" &&
      typeof file.mimeType === "string" &&
      typeof file.size === "number" &&
      Number.isFinite(file.size) &&
      file.size >= 0
      ? { ok: true }
      : invalid(`${hookName} data.file must contain filename, mimeType, and a non-negative size.`);
  }

  if (!hasOnlyKeys(value, ["media", "principal", "member"])) {
    return invalid(`${hookName} data contains unsupported fields.`);
  }
  const media = value.media;
  return isRecord(media) &&
    hasOnlyKeys(media, ["id", "status", "filename", "mimeType", "size", "folderId"]) &&
    typeof media.id === "string" &&
    typeof media.status === "string" &&
    typeof media.filename === "string" &&
    typeof media.mimeType === "string" &&
    typeof media.size === "number" &&
    Number.isFinite(media.size) &&
    media.size >= 0 &&
    (media.folderId === null || typeof media.folderId === "string")
    ? { ok: true }
    : invalid(`${hookName} data.media does not match the canonical upload result.`);
}

export function npValidatePluginHookData(
  hookName: string,
  value: unknown,
): NpPluginHookValidationResult {
  if (!npIsPluginHookName(hookName)) {
    return invalid(`Unsupported plugin hook "${hookName}".`);
  }
  if (hookName.startsWith("content:")) {
    return validateContentHookData(
      hookName as Extract<NpPluginHookName, `content:${string}`>,
      value,
    );
  }
  if (hookName.startsWith("auth:")) {
    return validateAuthHookData(hookName as Extract<NpPluginHookName, `auth:${string}`>, value);
  }
  if (hookName.startsWith("media:")) {
    return validateMediaHookData(hookName as Extract<NpPluginHookName, `media:${string}`>, value);
  }

  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["collection", "slug", "document"]) ||
    typeof value.collection !== "string" ||
    typeof value.slug !== "string" ||
    !isRecord(value.document)
  ) {
    return invalid(
      "render:beforePage data requires collection, slug, and document with no extra fields.",
    );
  }
  return { ok: true };
}

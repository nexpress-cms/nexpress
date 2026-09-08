import { and, eq, isNull } from "drizzle-orm";

import { can } from "../auth/capabilities.js";
import { npCollectionDocumentToWriteInput } from "../collection-contract/contract.js";
import {
  npGetPersistedCollectionDocumentById,
  npAssertCollectionWriteAccess,
  npAssertCollectionReadAccess,
  npAssertCollectionReadScope,
} from "../collections/pipeline.js";
import { getCollectionConfig } from "../collections/registry.js";
import { applySlugField } from "../collections/slug.js";
import { getCollectionZodSchema } from "../collections/validation.js";
import type { NpAuthUser, NpFieldConfig } from "../config/types.js";
import {
  npCollectContentTransferMediaReferences,
  npCollectContentTransferRelationshipReferences,
} from "../content-transfer-contract/media.js";
import { getDb } from "../db/runtime.js";
import { npMedia } from "../db/schema/media.js";
import { npNavigation, npSettings } from "../db/schema/system.js";
import { getI18nConfig } from "../i18n/registry.js";
import type { NpNavItem } from "../navigation/types.js";
import { npNormalizeSeoSettings } from "../settings/contract.js";
import { withCurrentSite } from "../sites/context.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { getActiveTheme } from "../themes/registry.js";
import {
  npAgentChangeSetOperationMatchesResourceKey,
  npRequireAgentChangeSetOperationInput,
  npRequireAgentChangeSetResourceKey,
} from "../agent-contract/changeset-contract.js";
import { npAgentScopeStaffCapability } from "../agent-contract/types.js";
import type {
  NpAgentChangeSetOperationInput,
  NpAgentChangeSetResourceKeyV1,
  NpAgentJsonObject,
  NpAgentJsonValue,
  NpAgentScope,
} from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";

interface ResourceContext {
  siteId: string;
  /** Already resolved from current staff admission or the principal's live backing authority. */
  user: NpAuthUser;
  operation: NpAgentChangeSetOperationInput;
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
}
export interface NpAgentChangeSetPrepareResourceInputV1 extends ResourceContext {
  /** All create reservations in this draft, including earlier accepted operations. */
  reservedCreateDocumentIds: readonly string[];
}
export interface NpAgentChangeSetPreparedResourceV1 {
  operation: NpAgentChangeSetOperationInput;
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
  requiredScopes: NpAgentScope[];
}
const invalid = () =>
  new NpAgentGatewayError("CHANGESET_SCHEMA_INVALID", 400, "ChangeSet resource input is invalid.");
const denied = () =>
  new NpAgentGatewayError("CHANGESET_ACCESS_DENIED", 403, "ChangeSet resource access is denied.");
const missing = () =>
  new NpAgentGatewayError(
    "CHANGESET_RESOURCE_NOT_FOUND",
    404,
    "ChangeSet resource is unavailable.",
  );
const reference = () =>
  new NpAgentGatewayError(
    "CHANGESET_REFERENCE_INVALID",
    400,
    "ChangeSet reference is unavailable.",
  );
const forbiddenFields = new Set([
  "id",
  "siteId",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "authorId",
  "memberAuthorId",
  "_status",
  "_version",
  "revisionId",
  "revisionVersion",
  "tempId",
  "$ref",
]);

function requireScopes(user: NpAuthUser, scopes: Iterable<NpAgentScope>): void {
  for (const scope of scopes) if (!can(user, npAgentScopeStaffCapability[scope])) throw denied();
}
function proposalScope(operation: NpAgentChangeSetOperationInput): NpAgentScope {
  switch (operation.kind) {
    case "document":
      return "content:draft";
    case "navigation":
      return "navigation:write";
    case "theme_tokens":
      return "theme:write";
    case "setting":
      return "settings:write";
    case "media_ref":
      return "media:write";
  }
}
function readScope(operation: NpAgentChangeSetOperationInput): NpAgentScope {
  switch (operation.kind) {
    case "document":
      return "content:read";
    case "navigation":
      return "navigation:read";
    case "theme_tokens":
      return "theme:read";
    case "setting":
      return "settings:read";
    case "media_ref":
      return "media:read";
  }
}
function json(value: unknown): NpAgentJsonValue {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(json);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, json(child)]),
    );
  }
  return value as NpAgentJsonValue;
}
function collection(slug: string) {
  try {
    return getCollectionConfig(slug);
  } catch {
    throw missing();
  }
}
async function persisted(siteId: string, user: NpAuthUser, slug: string, id: string) {
  const config = collection(slug);
  let document: Record<string, unknown> | null;
  try {
    document = await npGetPersistedCollectionDocumentById(slug, id, siteId);
  } catch {
    throw missing();
  }
  if (!document) throw missing();
  try {
    await npAssertCollectionReadAccess(config, slug, user, document);
  } catch {
    throw missing();
  }
  if (document.status !== undefined && document.status !== "published")
    requireScopes(user, ["content:draft"]);
  return { config, document };
}
function fieldNamed(fields: readonly NpFieldConfig[], name: string): NpFieldConfig | undefined {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      const match = fieldNamed(field.fields, name);
      if (match) return match;
    } else if (field.name === name) return field;
  }
  return undefined;
}

function rejectProtectedFields(
  fields: readonly NpFieldConfig[],
  supplied: Record<string, unknown>,
): void {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      rejectProtectedFields(field.fields, supplied);
      continue;
    }
    if (!Object.hasOwn(supplied, field.name)) continue;
    if (field.hidden || field.admin?.readOnly) throw invalid();
    const value = supplied[field.name];
    if (
      field.type === "group" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    )
      rejectProtectedFields(field.fields, value as Record<string, unknown>);
    if (field.type === "array" && Array.isArray(value))
      for (const row of value) {
        if (typeof row === "object" && row !== null && !Array.isArray(row))
          rejectProtectedFields(field.fields, row as Record<string, unknown>);
      }
  }
}

/** Keep server defaults available to validation and ACLs, outside the editable draft body. */
function editableDocument(
  fields: readonly NpFieldConfig[],
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  const editable = { ...candidate };
  const strip = (nestedFields: readonly NpFieldConfig[]) => {
    for (const field of nestedFields) {
      if (field.type === "row" || field.type === "collapsible") {
        strip(field.fields);
        continue;
      }
      if (field.hidden || field.admin?.readOnly) {
        delete editable[field.name];
        continue;
      }
      const value = editable[field.name];
      if (
        field.type === "group" &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      )
        editable[field.name] = editableDocument(field.fields, value as Record<string, unknown>);
      if (field.type === "array" && Array.isArray(value))
        editable[field.name] = value.map((row: unknown) =>
          row !== null && typeof row === "object" && !Array.isArray(row)
            ? editableDocument(field.fields, row as Record<string, unknown>)
            : row,
        );
    }
  };
  strip(fields);
  return editable;
}

/** Read-only resource acceptance. UUID allocation and draft persistence belong to the draft service. */
export function createAgentChangeSetResourceServiceV1() {
  async function media(siteId: string, user: NpAuthUser, id: string) {
    requireScopes(user, ["media:read"]);
    const [row] = await getDb()
      .select({ id: npMedia.id })
      .from(npMedia)
      .where(and(eq(npMedia.siteId, siteId), eq(npMedia.id, id), isNull(npMedia.deletedAt)))
      .limit(1);
    if (!row) throw reference();
  }
  async function references(
    siteId: string,
    user: NpAuthUser,
    fields: readonly NpFieldConfig[],
    value: Record<string, unknown>,
    reserved: ReadonlySet<string>,
    scopes: Set<NpAgentScope>,
  ) {
    const relationships = npCollectContentTransferRelationshipReferences(fields, value);
    if (relationships.length) scopes.add("content:read");
    const seenRelationships = new Set<string>();
    for (const target of relationships) {
      const key = JSON.stringify([target.collection, target.documentId]);
      if (seenRelationships.has(key)) continue;
      seenRelationships.add(key);
      if (reserved.has(target.documentId)) throw reference();
      try {
        const targetDocument = await persisted(siteId, user, target.collection, target.documentId);
        if (
          targetDocument.document.status !== undefined &&
          targetDocument.document.status !== "published"
        )
          scopes.add("content:draft");
      } catch {
        throw reference();
      }
    }
    const mediaReferences = npCollectContentTransferMediaReferences(fields, value);
    if (mediaReferences.length) scopes.add("media:read");
    for (const id of new Set(mediaReferences.map((target) => target.mediaId)))
      await media(siteId, user, id);
  }
  async function navigation(
    siteId: string,
    user: NpAuthUser,
    items: NpNavItem[],
    reserved: ReadonlySet<string>,
    scopes: Set<NpAgentScope>,
  ) {
    for (const item of items) {
      if (item.type === "page") {
        if (reserved.has(item.pageId)) throw reference();
        scopes.add("content:read");
        try {
          const targetDocument = await persisted(
            siteId,
            user,
            item.collectionSlug ?? "pages",
            item.pageId,
          );
          if (
            targetDocument.document.status !== undefined &&
            targetDocument.document.status !== "published"
          )
            scopes.add("content:draft");
        } catch {
          throw reference();
        }
      } else if (item.type === "collection") {
        try {
          await npAssertCollectionReadScope(collection(item.collection), item.collection, user);
        } catch {
          throw reference();
        }
      }
      if (item.children) await navigation(siteId, user, item.children, reserved, scopes);
    }
  }
  async function resolve(
    input: ResourceContext,
    writable: boolean,
    reserved: ReadonlySet<string>,
  ): Promise<NpAgentChangeSetPreparedResourceV1> {
    if (!npIsCanonicalSiteId(input.siteId)) throw invalid();
    let operation: NpAgentChangeSetOperationInput;
    let canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
    try {
      operation = npRequireAgentChangeSetOperationInput(input.operation);
      canonicalResourceKey = npRequireAgentChangeSetResourceKey(input.canonicalResourceKey);
      if (!npAgentChangeSetOperationMatchesResourceKey(operation, canonicalResourceKey))
        throw invalid();
    } catch {
      throw invalid();
    }
    const scopes = new Set<NpAgentScope>([
      writable ? proposalScope(operation) : readScope(operation),
    ]);
    requireScopes(input.user, scopes);
    return withCurrentSite(input.siteId, async () => {
      if (operation.kind === "document") {
        const config = collection(operation.resource.collection);
        const creating = operation.operation === "create";
        if (canonicalResourceKey.kind !== "document") throw invalid();
        const original = creating
          ? null
          : (
              await persisted(
                input.siteId,
                input.user,
                operation.resource.collection,
                canonicalResourceKey.documentId,
              )
            ).document;
        if (original && original.status !== undefined && original.status !== "published")
          scopes.add("content:draft");
        if (creating && writable) {
          let collision: Record<string, unknown> | null;
          try {
            collision = await npGetPersistedCollectionDocumentById(
              operation.resource.collection,
              canonicalResourceKey.documentId,
              input.siteId,
            );
          } catch {
            throw reference();
          }
          if (collision) throw reference();
        }
        const supplied =
          operation.operation === "create"
            ? operation.input.document
            : operation.operation === "update"
              ? operation.input.patch
              : null;
        let candidate: Record<string, unknown> = original
          ? npCollectionDocumentToWriteInput(original, config)
          : {};
        if (supplied) {
          if (Object.keys(supplied).some((key) => forbiddenFields.has(key))) throw invalid();
          rejectProtectedFields(config.fields, supplied);
          candidate = { ...candidate, ...supplied };
          try {
            candidate = getCollectionZodSchema(config, candidate).parse(candidate) as Record<
              string,
              unknown
            >;
            applySlugField(config, candidate, original);
            if (config.i18n) {
              const i18n = getI18nConfig();
              if (!i18n) throw invalid();
              if (
                original &&
                (candidate.locale !== original.locale ||
                  candidate.translationGroupId !== original.translationGroupId)
              )
                throw invalid();
              candidate.locale ??= i18n.defaultLocale;
              if (!i18n.locales.includes(candidate.locale as string)) throw invalid();
            }
          } catch {
            throw invalid();
          }
        }
        if (writable) {
          try {
            await npAssertCollectionWriteAccess(
              config,
              operation.resource.collection,
              creating ? "create" : "update",
              input.user,
              candidate,
              original,
            );
          } catch {
            throw denied();
          }
        } else if (creating) {
          try {
            await npAssertCollectionReadScope(config, operation.resource.collection, input.user);
          } catch {
            throw missing();
          }
        }
        await references(input.siteId, input.user, config.fields, candidate, reserved, scopes);
        const editable = editableDocument(config.fields, candidate);
        if (operation.operation === "create")
          operation = {
            ...operation,
            input: { ...operation.input, document: json(editable) as NpAgentJsonObject },
          };
        if (operation.operation === "update")
          operation = {
            ...operation,
            input: {
              ...operation.input,
              patch: json(
                Object.fromEntries(
                  Object.keys(operation.input.patch).map((key) => [key, editable[key]]),
                ),
              ) as NpAgentJsonObject,
            },
          };
      } else if (operation.kind === "navigation") {
        const [row] = await getDb()
          .select({ location: npNavigation.location })
          .from(npNavigation)
          .where(
            and(
              eq(npNavigation.siteId, input.siteId),
              eq(npNavigation.location, operation.resource.location),
            ),
          )
          .limit(1);
        if (!row) throw missing();
        await navigation(input.siteId, input.user, operation.input.items, reserved, scopes);
      } else if (operation.kind === "theme_tokens") {
        const active = await getActiveTheme();
        if (!active || active.manifest.id !== operation.resource.themeId) throw missing();
      } else if (operation.kind === "setting") {
        if (operation.operation === "remove" || operation.base !== null) {
          const [row] = await getDb()
            .select({ key: npSettings.key })
            .from(npSettings)
            .where(
              and(eq(npSettings.siteId, input.siteId), eq(npSettings.key, operation.resource.key)),
            )
            .limit(1);
          if (!row) throw missing();
        }
        if (operation.operation === "replace")
          operation = {
            ...operation,
            input: {
              value: npNormalizeSeoSettings(operation.input.value) as unknown as NpAgentJsonValue,
            },
          };
      } else {
        scopes.add("media:read");
        scopes.add(writable ? "content:draft" : "content:read");
        if (reserved.has(operation.resource.documentId)) throw reference();
        const owner = await persisted(
          input.siteId,
          input.user,
          operation.resource.collection,
          operation.resource.documentId,
        );
        if (owner.document.status !== undefined && owner.document.status !== "published")
          scopes.add("content:draft");
        const field = fieldNamed(owner.config.fields, operation.resource.field);
        if (!field || !["upload", "richText"].includes(field.type)) throw reference();
        rejectProtectedFields(owner.config.fields, { [operation.resource.field]: null });
        await media(input.siteId, input.user, operation.resource.mediaId);
        if (writable) {
          try {
            await npAssertCollectionWriteAccess(
              owner.config,
              operation.resource.collection,
              "update",
              input.user,
              npCollectionDocumentToWriteInput(owner.document, owner.config),
              owner.document,
            );
          } catch {
            throw denied();
          }
        }
      }
      requireScopes(input.user, scopes);
      return {
        operation: npRequireAgentChangeSetOperationInput(operation),
        canonicalResourceKey,
        requiredScopes: [...scopes].sort(),
      };
    });
  }
  return {
    prepare: (input: NpAgentChangeSetPrepareResourceInputV1) =>
      resolve(input, true, new Set(input.reservedCreateDocumentIds)),
    assertVisible: async (input: ResourceContext): Promise<NpAgentScope[]> =>
      (await resolve(input, false, new Set())).requiredScopes,
  };
}
export type NpAgentChangeSetResourceServiceV1 = ReturnType<
  typeof createAgentChangeSetResourceServiceV1
>;

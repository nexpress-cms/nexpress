import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getPluginRoutes,
  type NpCollectionConfig,
} from "@nexpress/core";
import {
  npThemeTokenGroups,
  npThemeTokenKeys,
  npThemeOptionalTokenKeys,
  type NpThemeTokenGroup,
} from "@nexpress/core/theme";
import {
  npNavigationCollectionSlugPattern,
  npNavigationItemIdPattern,
  npNavigationLimits,
  npNavigationLocationPattern,
} from "@nexpress/core/navigation";
import {
  npMediaAttachmentExtensions,
  npMediaAttachmentLimits,
  npMediaAttachmentMimeTypes,
  npMediaAttachmentStatuses,
  npMediaContractLimits,
  npMediaStorageKeyPattern,
  npMediaStatuses,
  npMediaVariantNamePattern,
} from "@nexpress/core/media-contract";
import {
  npAuthCanonicalDatePattern,
  npAuthContractLimits,
  npAuthSingleUseTokenPattern,
  npAuthUuidPattern,
  npMemberHandlePattern,
  npMemberStatuses,
  npUserRoles,
} from "@nexpress/core/auth-contract";
import {
  npCommunityCommentStatuses,
  npCommunityContractLimits,
  npCommunityReportResolutionActions,
  npCommunityThreadModerationActions,
} from "@nexpress/core/community-contract";
import {
  npDynamicSettingOwnerPattern,
  npSettingsContractLimits,
  npSiteIdPattern,
  npUserIdPattern,
} from "@nexpress/core/settings";
import {
  NP_REVISION_STATUSES,
  npRevisionCanonicalDatePattern,
  npRevisionContractLimits,
} from "@nexpress/core/revisions";
import {
  npCollectionContractLimits,
  npCollectionDocumentCanonicalDatePattern,
  npCollectionDocumentSlugPattern,
  npCollectionDocumentStatuses,
  npCollectionDocumentVisibilities,
} from "@nexpress/core/collection-contract";
import { npDiscoveryContractLimits, npPluginDiscoveryProvideKeys } from "@nexpress/core/discovery";
import {
  NP_CONTENT_TRANSFER_VERSION,
  npContentTransferCanonicalDatePattern,
  npContentTransferCollectionSlugPattern,
  npContentTransferContractLimits,
  npContentTransferMimeTypePattern,
  npContentTransferPluginIdPattern,
  npContentTransferPluginVersionPattern,
  npContentTransferSha256Pattern,
  npContentTransferUuidPattern,
} from "@nexpress/core/content-transfer";
import { npSearchCollectionSlugPattern, npSearchContractLimits } from "@nexpress/core/search";
import { NextResponse } from "next/server";

import { ensureFor } from "../../lib/init-core";
import { collectionToManifest, type NpFieldManifest } from "../../lib/manifest";
import {
  npApiErrorOpenApiResponses,
  npApplyApiErrorOpenApiResponses,
  npCreateApiErrorOpenApiSchemas,
} from "../../lib/openapi-api-errors";

type OpenApiSchema = Record<string, unknown>;

const blockNonWhitespaceTextPattern = "^(?=[\\s\\S]*\\S)[\\s\\S]+$";

function blockMetadataText(maxLength: number): OpenApiSchema {
  return {
    type: "string",
    minLength: 1,
    maxLength,
    pattern: blockNonWhitespaceTextPattern,
  };
}

const blockPropCommonProperties: Record<string, OpenApiSchema> = {
  name: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z_][A-Za-z0-9_-]*$",
  },
  label: blockMetadataText(100),
  required: { type: "boolean" },
  description: blockMetadataText(500),
  group: blockMetadataText(100),
  hiddenWhen: {
    type: "array",
    minItems: 1,
    maxItems: npDiscoveryContractLimits.fields,
    items: { $ref: "#/components/schemas/block_discovery_condition" },
  },
  visibleWhen: {
    type: "array",
    minItems: 1,
    maxItems: npDiscoveryContractLimits.fields,
    items: { $ref: "#/components/schemas/block_discovery_condition" },
  },
};

function blockPropVariant(
  type: string,
  required: string[],
  properties: Record<string, OpenApiSchema>,
): OpenApiSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "label", "type", ...required],
    properties: {
      ...blockPropCommonProperties,
      type: { type: "string", const: type },
      ...properties,
    },
  };
}

const blockStringDefault: OpenApiSchema = {
  type: "string",
  maxLength: npDiscoveryContractLimits.jsonStringLength,
};

function blockPropPatternProperties(): Record<string, OpenApiSchema> {
  return {
    pattern: blockMetadataText(npDiscoveryContractLimits.textLength),
    validationMessage: blockMetadataText(300),
  };
}

const contentTransferCollectionFilterPattern = `^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,${(
  npContentTransferContractLimits.collectionSlugLength - 1
).toString()}}(?:,[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,${(
  npContentTransferContractLimits.collectionSlugLength - 1
).toString()}})*$`;

function themeTokenGroupSchema(group: NpThemeTokenGroup): OpenApiSchema {
  const optional = new Set<string>(npThemeOptionalTokenKeys[group]);
  return {
    type: "object",
    additionalProperties: false,
    required: npThemeTokenKeys[group].filter((key) => !optional.has(key)),
    properties: Object.fromEntries(
      npThemeTokenKeys[group].map((key) => [
        key,
        {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description:
            "Trimmed CSS token value; statement and resource-loading syntax is rejected.",
        },
      ]),
    ),
  };
}

const themeTokensSchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: [...npThemeTokenGroups],
  properties: Object.fromEntries(
    npThemeTokenGroups.map((group) => [group, themeTokenGroupSchema(group)]),
  ),
};

const themeTokensOverlaySchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    npThemeTokenGroups.map((group) => [
      group,
      {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          npThemeTokenKeys[group].map((key) => [
            key,
            {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description:
                "Trimmed CSS token value; statement and resource-loading syntax is rejected.",
            },
          ]),
        ),
      },
    ]),
  ),
};

function fieldToSchema(field: NpFieldManifest, exactDocument = false): OpenApiSchema {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "radio":
      return { type: "string", ...(field.options && { enum: field.options.map((o) => o.value) }) };
    case "select": {
      const item = { type: "string", enum: field.options?.map((option) => option.value) ?? [] };
      return field.hasMany ? { type: "array", items: item } : item;
    }
    case "number":
      return { type: field.integerOnly ? "integer" : "number" };
    case "checkbox":
      return { type: "boolean" };
    case "date":
      return {
        type: "string",
        format: "date-time",
        ...(exactDocument && { pattern: npCollectionDocumentCanonicalDatePattern }),
      };
    case "richText":
      return {
        type: "object",
        additionalProperties: false,
        required: ["version", "document"],
        properties: {
          version: { type: "integer", enum: [1] },
          document: {
            type: "object",
            additionalProperties: false,
            required: ["root"],
            properties: {
              root: {
                type: "object",
                additionalProperties: false,
                required: ["type", "children", "direction", "format", "indent", "version"],
                properties: {
                  type: { type: "string", enum: ["root"] },
                  children: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["type", "version"],
                      additionalProperties: true,
                    },
                  },
                  direction: { type: ["string", "null"], enum: ["ltr", "rtl", null] },
                  format: { type: "string" },
                  indent: { type: "integer", minimum: 0 },
                  version: { type: "integer", minimum: 1 },
                },
              },
            },
          },
        },
      };
    case "blocks":
      return {
        type: "array",
        items: { $ref: "#/components/schemas/block_instance" },
      };
    case "json":
      return {};
    case "upload":
    case "relationship":
      return field.hasMany
        ? { type: "array", items: { type: "string", format: "uuid" } }
        : { type: "string", format: "uuid" };
    case "array": {
      const nested = flattenManifestFields(field.fields ?? []);
      return {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            nested.map((nestedField) => [
              nestedField.name,
              nullableCollectionFieldSchema(nestedField, exactDocument),
            ]),
          ),
          required: nested
            .filter((nestedField) => exactDocument || isRequiredCollectionWriteField(nestedField))
            .map((nestedField) => nestedField.name),
        },
      };
    }
    case "group": {
      const nested = flattenManifestFields(field.fields ?? []);
      return {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          nested.map((nestedField) => [
            nestedField.name,
            nullableCollectionFieldSchema(nestedField, exactDocument),
          ]),
        ),
        required: nested
          .filter((nestedField) => exactDocument || isRequiredCollectionWriteField(nestedField))
          .map((nestedField) => nestedField.name),
      };
    }
    default:
      return { type: "object", additionalProperties: true };
  }
}

function nullableCollectionFieldSchema(
  field: NpFieldManifest,
  exactDocument = false,
): OpenApiSchema {
  const schema = fieldToSchema(field, exactDocument);
  if (
    field.required ||
    field.type === "array" ||
    (field.type === "relationship" && field.hasMany)
  ) {
    return schema;
  }
  return { anyOf: [schema, { type: "null" }] };
}

function isRequiredCollectionWriteField(field: NpFieldManifest): boolean {
  return field.required === true && field.defaultValue === undefined;
}

function collectionFieldProperties(
  manifest: ReturnType<typeof collectionToManifest>,
  exactDocument = false,
): Record<string, OpenApiSchema> {
  return Object.fromEntries(
    flattenManifestFields(manifest.fields).map((field) => [
      field.name,
      {
        ...nullableCollectionFieldSchema(field, exactDocument),
        ...(field.description && { description: field.description }),
      },
    ]),
  );
}

function hasManifestField(
  manifest: ReturnType<typeof collectionToManifest>,
  name: string,
): boolean {
  return flattenManifestFields(manifest.fields).some((field) => field.name === name);
}

function collectionDocumentSchema(
  manifest: ReturnType<typeof collectionToManifest>,
  config: NpCollectionConfig,
): OpenApiSchema {
  const properties: Record<string, OpenApiSchema> = {
    id: { type: "string", format: "uuid" },
    status: { type: "string", enum: [...npCollectionDocumentStatuses] },
    createdBy: { type: ["string", "null"], format: "uuid" },
    updatedBy: { type: ["string", "null"], format: "uuid" },
    visibility: { type: "string", enum: [...npCollectionDocumentVisibilities] },
    siteId: { type: "string", pattern: npSiteIdPattern },
    ...collectionFieldProperties(manifest, true),
  };
  if (config.timestamps !== false) {
    properties.createdAt = {
      type: "string",
      format: "date-time",
      pattern: npCollectionDocumentCanonicalDatePattern,
    };
    properties.updatedAt = {
      type: "string",
      format: "date-time",
      pattern: npCollectionDocumentCanonicalDatePattern,
    };
  }
  if (config.community?.memberWrite?.create) {
    properties.memberAuthorId = { type: ["string", "null"], format: "uuid" };
  }
  if (manifest.slug_auto) {
    properties.slug = {
      type: "string",
      minLength: 1,
      maxLength: npCollectionContractLimits.slugLength,
      pattern: npCollectionDocumentSlugPattern,
    };
  }
  if (config.i18n) {
    properties.locale = {
      type: "string",
      minLength: 1,
      maxLength: npCollectionContractLimits.localeLength,
    };
    properties.translationGroupId = { type: "string", format: "uuid" };
  }
  if (manifest.versions.drafts && !hasManifestField(manifest, "publishedAt")) {
    properties.publishedAt = {
      anyOf: [
        {
          type: "string",
          format: "date-time",
          pattern: npCollectionDocumentCanonicalDatePattern,
        },
        { type: "null" },
      ],
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

function collectionWriteSchema(
  manifest: ReturnType<typeof collectionToManifest>,
  config: NpCollectionConfig,
  patch: boolean,
): OpenApiSchema {
  const properties: Record<string, OpenApiSchema> = collectionFieldProperties(manifest);
  properties.visibility = {
    type: "string",
    enum: [...npCollectionDocumentVisibilities],
  };
  properties._status = {
    type: "string",
    enum: [...npCollectionDocumentStatuses],
    description:
      "Request-only status transition. The canonical response field is `status`; `_status` is never stored or returned.",
  };
  if (manifest.slug_auto) {
    properties.slug = {
      type: "string",
      minLength: 1,
      maxLength: 2048,
      description: "Optional explicit slug; otherwise derived from the configured source field.",
    };
  }
  if (config.i18n) {
    properties.locale = {
      type: "string",
      minLength: 1,
      maxLength: npCollectionContractLimits.localeLength,
    };
    properties.translationGroupId = { type: "string", format: "uuid" };
  }
  if (manifest.versions.drafts && !hasManifestField(manifest, "publishedAt")) {
    properties.publishedAt = {
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(!patch && {
      required: flattenManifestFields(manifest.fields)
        .filter(isRequiredCollectionWriteField)
        .map((field) => field.name),
    }),
  };
}

function flattenManifestFields(fields: NpFieldManifest[]): NpFieldManifest[] {
  return fields.flatMap((field) =>
    field.type === "row" || field.type === "collapsible"
      ? flattenManifestFields(field.fields ?? [])
      : [field],
  );
}

function revisionFieldToSchema(field: NpFieldManifest): OpenApiSchema {
  if (field.type === "date") {
    return {
      type: "string",
      format: "date-time",
      pattern: npRevisionCanonicalDatePattern,
      maxLength: npRevisionContractLimits.stringLength,
    };
  }
  if (field.type === "array") {
    return {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          flattenManifestFields(field.fields ?? []).map((nested) => [
            nested.name,
            revisionFieldValueSchema(nested),
          ]),
        ),
      },
    };
  }
  if (field.type === "group") {
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        flattenManifestFields(field.fields ?? []).map((nested) => [
          nested.name,
          revisionFieldValueSchema(nested),
        ]),
      ),
    };
  }
  const schema = fieldToSchema(field);
  if (schema.type === "string") {
    return { ...schema, maxLength: npRevisionContractLimits.stringLength };
  }
  return schema;
}

function revisionFieldValueSchema(field: NpFieldManifest): OpenApiSchema {
  return {
    anyOf: [revisionFieldToSchema(field), { type: "null" }, { type: "string", maxLength: 0 }],
  };
}

function revisionSnapshotSchema(
  manifest: ReturnType<typeof collectionToManifest>,
  config: NpCollectionConfig,
): OpenApiSchema {
  const fields = flattenManifestFields(manifest.fields);
  const properties = Object.fromEntries(
    fields.map((field) => [
      field.name,
      {
        ...revisionFieldValueSchema(field),
        ...(field.description && { description: field.description }),
      },
    ]),
  ) as Record<string, OpenApiSchema>;

  properties.visibility = {
    anyOf: [
      { type: "string", enum: ["public", "private"] },
      { type: "null" },
      { type: "string", maxLength: 0 },
    ],
  };
  if (manifest.slug_auto) {
    properties.slug = {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Auto-derived from the configured source field unless set explicitly.",
    };
  }
  if (config.i18n) {
    properties.locale = { anyOf: [{ type: "string" }, { type: "null" }] };
    properties.translationGroupId = {
      anyOf: [
        { type: "string", format: "uuid" },
        { type: "null" },
        { type: "string", maxLength: 0 },
      ],
    };
  }
  if (manifest.versions.drafts && !fields.some((field) => field.name === "publishedAt")) {
    properties.publishedAt = {
      anyOf: [
        {
          type: "string",
          format: "date-time",
          pattern: npRevisionCanonicalDatePattern,
        },
        { type: "null" },
        { type: "string", maxLength: 0 },
      ],
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    maxProperties: npRevisionContractLimits.topLevelFields,
    properties,
    description:
      "Partial authoring snapshot. Required collection fields may be omitted while editing; every present field must follow its declared wire type.",
  };
}

export function buildSpec(): OpenApiSchema {
  const slugs = getAllCollectionSlugs();
  const communityTargetTypeSchema: OpenApiSchema = {
    type: "string",
    maxLength: 63,
    pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
  };
  const reportRowProperties: Record<string, OpenApiSchema> = {
    id: { type: "string", format: "uuid" },
    reporterId: { type: "string", format: "uuid" },
    targetType: communityTargetTypeSchema,
    targetId: { type: "string", format: "uuid" },
    reason: {
      type: "string",
      minLength: 1,
      maxLength: npCommunityContractLimits.reasonLength,
      pattern: "^(?!\\s)(?![\\s\\S]*\\s$)[\\s\\S]+$",
    },
    resolvedAt: { type: ["string", "null"], format: "date-time" },
    resolvedByUserId: { type: ["string", "null"], format: "uuid" },
    resolvedByMemberId: { type: ["string", "null"], format: "uuid" },
    resolution: {
      type: ["string", "null"],
      enum: [...npCommunityReportResolutionActions, null],
    },
    siteId: { type: "string", pattern: npSiteIdPattern },
    createdAt: { type: "string", format: "date-time" },
  };
  const reportRowRequired = Object.keys(reportRowProperties);
  const commentWireProperties: Record<string, OpenApiSchema> = {
    id: { type: "string", format: "uuid" },
    targetType: { ...communityTargetTypeSchema },
    targetId: { type: "string", format: "uuid" },
    parentId: { type: ["string", "null"], format: "uuid" },
    memberId: { type: "string", format: "uuid" },
    bodyMd: { type: "string", maxLength: npCommunityContractLimits.bodyLength },
    bodyHtml: { type: "string", maxLength: npCommunityContractLimits.htmlLength },
    status: { type: "string", enum: [...npCommunityCommentStatuses] },
    hiddenByUserId: { type: ["string", "null"], format: "uuid" },
    hiddenByMemberId: { type: ["string", "null"], format: "uuid" },
    hiddenReason: {
      type: ["string", "null"],
      maxLength: npCommunityContractLimits.reasonLength,
    },
    editedAt: { type: ["string", "null"], format: "date-time" },
    siteId: { type: "string", pattern: npSiteIdPattern },
    createdAt: { type: "string", format: "date-time" },
    authorStatus: { type: ["string", "null"], enum: [...npMemberStatuses, null] },
  };
  const commentWireRequired = Object.keys(commentWireProperties).filter(
    (key) => key !== "authorStatus",
  );
  const reportTargetContextProperties: Record<string, OpenApiSchema> = {
    kind: { type: "string", enum: ["comment", "document", "member", "missing"] },
    label: {
      type: "string",
      minLength: 1,
      maxLength: npCommunityContractLimits.labelLength,
    },
    excerpt: {
      type: ["string", "null"],
      maxLength: npCommunityContractLimits.descriptionLength,
    },
    status: {
      type: ["string", "null"],
      enum: [
        ...new Set([
          ...npCommunityCommentStatuses,
          ...npCollectionDocumentStatuses,
          ...npMemberStatuses,
        ]),
        null,
      ],
    },
    href: { type: ["string", "null"], maxLength: 512, pattern: "^/admin/" },
    collectionSlug: { ...communityTargetTypeSchema, type: ["string", "null"] },
    documentId: { type: ["string", "null"], format: "uuid" },
    authorMemberId: { type: ["string", "null"], format: "uuid" },
  };
  const contentTransferBaseProperties: Record<string, OpenApiSchema> = {
    version: { type: "string", enum: [NP_CONTENT_TRANSFER_VERSION] },
    exportedAt: {
      type: "string",
      format: "date-time",
      pattern: npContentTransferCanonicalDatePattern,
    },
    siteUrl: {
      type: ["string", "null"],
      format: "uri",
      maxLength: 2048,
      description:
        "Canonical HTTP(S) origin. For a full transfer it must exactly equal `site.url`.",
    },
    collectionsExported: {
      type: "array",
      maxItems: npContentTransferContractLimits.collections,
      uniqueItems: true,
      items: {
        type: "string",
        maxLength: npContentTransferContractLimits.collectionSlugLength,
        pattern: npContentTransferCollectionSlugPattern,
        ...(slugs.length > 0 ? { enum: slugs } : {}),
      },
      description: "Sorted unique inventory that exactly matches the `collections` keys.",
    },
    collections: { $ref: "#/components/schemas/content_transfer_collections" },
    media: {
      type: "array",
      maxItems: npContentTransferContractLimits.mediaItems,
      items: { $ref: "#/components/schemas/content_transfer_media_item" },
      description: "Sorted exact manifest of media ids referenced by transferred documents.",
    },
  };
  const contentTransferBaseRequired = [
    "version",
    "exportedAt",
    "siteUrl",
    "partial",
    "collectionsExported",
    "collections",
    "media",
  ];
  const schemas: Record<string, OpenApiSchema> = {
    community_follow_row: {
      type: "object",
      additionalProperties: false,
      required: ["id", "followerId", "targetType", "targetId", "siteId", "createdAt"],
      properties: {
        id: { type: "string", format: "uuid" },
        followerId: { type: "string", format: "uuid" },
        targetType: { ...communityTargetTypeSchema },
        targetId: { type: "string", format: "uuid" },
        siteId: { type: "string", pattern: npSiteIdPattern },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    community_follow_list: {
      type: "object",
      additionalProperties: false,
      required: ["follows"],
      properties: {
        follows: {
          type: "array",
          maxItems: npCommunityContractLimits.pageRows,
          items: { $ref: "#/components/schemas/community_follow_row" },
        },
      },
    },
    community_following: {
      type: "object",
      additionalProperties: false,
      required: ["following"],
      properties: { following: { type: "boolean" } },
    },
    community_ok: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { type: "boolean", const: true } },
    },
    community_comment_author: {
      type: "object",
      additionalProperties: false,
      required: ["handle", "displayName", "avatarUrl"],
      properties: {
        handle: { type: "string", pattern: npMemberHandlePattern, maxLength: 30 },
        displayName: { type: "string", maxLength: 120 },
        avatarUrl: { type: ["string", "null"], format: "uri-reference", maxLength: 2048 },
      },
    },
    community_reaction_summary: {
      type: "object",
      additionalProperties: false,
      required: ["counts", "mine"],
      properties: {
        counts: {
          type: "object",
          maxProperties: npCommunityContractLimits.reactionKinds,
          propertyNames: { pattern: "^[a-z][a-z0-9_-]{0,29}$" },
          additionalProperties: { type: "integer", minimum: 0 },
        },
        mine: {
          type: "array",
          maxItems: npCommunityContractLimits.reactionKinds,
          uniqueItems: true,
          items: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,29}$" },
        },
      },
    },
    community_comment_row: {
      type: "object",
      additionalProperties: false,
      required: commentWireRequired,
      properties: commentWireProperties,
    },
    community_comment_list_item: {
      type: "object",
      additionalProperties: false,
      required: [...commentWireRequired, "author", "reactions"],
      properties: {
        ...commentWireProperties,
        author: {
          anyOf: [{ $ref: "#/components/schemas/community_comment_author" }, { type: "null" }],
        },
        reactions: { $ref: "#/components/schemas/community_reaction_summary" },
      },
    },
    community_comment_list: {
      type: "object",
      additionalProperties: false,
      required: ["comments", "totalDocs", "limit", "offset", "hasNextPage", "hasPrevPage"],
      properties: {
        comments: {
          type: "array",
          maxItems: npCommunityContractLimits.pageRows,
          items: { $ref: "#/components/schemas/community_comment_list_item" },
        },
        totalDocs: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: npCommunityContractLimits.pageRows },
        offset: { type: "integer", minimum: 0 },
        hasNextPage: { type: "boolean" },
        hasPrevPage: { type: "boolean" },
      },
    },
    community_public_member_profile: {
      type: "object",
      additionalProperties: false,
      required: ["id", "handle", "displayName", "avatarUrl", "bio", "reputation", "joinedAt"],
      properties: {
        id: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        handle: { type: "string", pattern: npMemberHandlePattern, maxLength: 30 },
        displayName: {
          type: "string",
          minLength: 1,
          maxLength: npAuthContractLimits.displayNameLength,
        },
        avatarUrl: { type: ["string", "null"], format: "uri-reference", maxLength: 2048 },
        bio: { type: ["string", "null"], maxLength: npAuthContractLimits.bioLength },
        reputation: { type: "integer" },
        joinedAt: {
          type: "string",
          format: "date-time",
          pattern: npAuthCanonicalDatePattern,
        },
      },
    },
    community_member_profile_document_activity: {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "collectionSlug",
        "collectionLabel",
        "documentId",
        "title",
        "href",
        "createdAt",
        "updatedAt",
      ],
      properties: {
        kind: { type: "string", const: "document" },
        collectionSlug: { ...communityTargetTypeSchema },
        collectionLabel: { type: "string", minLength: 1, maxLength: 120 },
        documentId: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        title: { type: "string", minLength: 1, maxLength: 240 },
        href: { type: ["string", "null"], maxLength: 2048, pattern: "^/(?!/)" },
        createdAt: {
          type: "string",
          format: "date-time",
          pattern: npAuthCanonicalDatePattern,
        },
        updatedAt: {
          type: "string",
          format: "date-time",
          pattern: npAuthCanonicalDatePattern,
        },
      },
    },
    community_member_profile_comment_activity: {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "commentId",
        "targetType",
        "targetId",
        "targetTitle",
        "href",
        "excerpt",
        "createdAt",
        "editedAt",
      ],
      properties: {
        kind: { type: "string", const: "comment" },
        commentId: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        targetType: { ...communityTargetTypeSchema },
        targetId: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        targetTitle: { type: "string", minLength: 1, maxLength: 240 },
        href: { type: ["string", "null"], maxLength: 2048, pattern: "^/(?!/)" },
        excerpt: {
          type: "string",
          maxLength: npCommunityContractLimits.profileActivityExcerptLength,
        },
        createdAt: {
          type: "string",
          format: "date-time",
          pattern: npAuthCanonicalDatePattern,
        },
        editedAt: {
          type: ["string", "null"],
          format: "date-time",
          pattern: npAuthCanonicalDatePattern,
        },
      },
    },
    community_member_profile_activity_page: {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "items",
        "totalDocs",
        "totalPages",
        "page",
        "limit",
        "hasNextPage",
        "hasPrevPage",
      ],
      properties: {
        kind: { type: "string", enum: ["documents", "comments"] },
        items: {
          type: "array",
          maxItems: npCommunityContractLimits.profileActivityPageRows,
          items: {
            oneOf: [
              { $ref: "#/components/schemas/community_member_profile_document_activity" },
              { $ref: "#/components/schemas/community_member_profile_comment_activity" },
            ],
          },
        },
        totalDocs: { type: "integer", minimum: 0 },
        totalPages: { type: "integer", minimum: 0 },
        page: { type: "integer", minimum: 1, maximum: 10_000 },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: npCommunityContractLimits.profileActivityPageRows,
        },
        hasNextPage: { type: "boolean" },
        hasPrevPage: { type: "boolean" },
      },
      allOf: [
        {
          if: { properties: { kind: { const: "documents" } } },
          then: {
            properties: {
              items: {
                items: {
                  $ref: "#/components/schemas/community_member_profile_document_activity",
                },
              },
            },
          },
        },
        {
          if: { properties: { kind: { const: "comments" } } },
          then: {
            properties: {
              items: {
                items: {
                  $ref: "#/components/schemas/community_member_profile_comment_activity",
                },
              },
            },
          },
        },
      ],
    },
    community_report_row: {
      type: "object",
      additionalProperties: false,
      required: reportRowRequired,
      properties: reportRowProperties,
    },
    community_report_target_context: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(reportTargetContextProperties),
      properties: reportTargetContextProperties,
    },
    community_moderation_report_row: {
      type: "object",
      additionalProperties: false,
      required: [...reportRowRequired, "target"],
      properties: {
        ...reportRowProperties,
        target: { $ref: "#/components/schemas/community_report_target_context" },
      },
    },
    community_moderation_report_page: {
      type: "object",
      additionalProperties: false,
      required: ["docs", "totalDocs", "totalPages", "page", "limit", "hasNextPage", "hasPrevPage"],
      properties: {
        docs: {
          type: "array",
          maxItems: npCommunityContractLimits.pageRows,
          items: { $ref: "#/components/schemas/community_moderation_report_row" },
        },
        totalDocs: { type: "integer", minimum: 0 },
        totalPages: { type: "integer", minimum: 0 },
        page: { type: "integer", minimum: 1 },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: npCommunityContractLimits.pageRows,
        },
        hasNextPage: { type: "boolean" },
        hasPrevPage: { type: "boolean" },
      },
    },
    content_transfer_json: {
      oneOf: [
        { type: "string", maxLength: npContentTransferContractLimits.jsonStringLength },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        {
          type: "array",
          maxItems: npContentTransferContractLimits.jsonArrayItems,
          items: { $ref: "#/components/schemas/content_transfer_json" },
        },
        {
          type: "object",
          maxProperties: npContentTransferContractLimits.jsonObjectKeys,
          propertyNames: {
            minLength: 1,
            maxLength: npContentTransferContractLimits.jsonKeyLength,
            not: { enum: ["__proto__", "constructor", "prototype"] },
          },
          additionalProperties: { $ref: "#/components/schemas/content_transfer_json" },
        },
      ],
    },
    content_transfer_media_item: {
      type: "object",
      additionalProperties: false,
      required: ["id", "filename", "hash", "mimeType"],
      properties: {
        id: { type: "string", format: "uuid", pattern: npContentTransferUuidPattern },
        filename: {
          type: "string",
          minLength: 1,
          maxLength: npMediaContractLimits.filenameLength,
          pattern: "^(?!\\s)(?!.*\\s$)[^\\u0000-\\u001F\\u007F]+$",
        },
        hash: { type: "string", pattern: npContentTransferSha256Pattern },
        mimeType: {
          type: "string",
          minLength: 3,
          maxLength: npMediaContractLimits.mimeTypeLength,
          pattern: npContentTransferMimeTypePattern,
        },
      },
    },
    content_transfer_plugin_state: {
      type: "object",
      additionalProperties: false,
      required: ["id", "enabled", "config", "manifestVersion"],
      properties: {
        id: { type: "string", maxLength: 128, pattern: npContentTransferPluginIdPattern },
        enabled: { type: "boolean" },
        config: {
          type: "object",
          maxProperties: npContentTransferContractLimits.jsonObjectKeys,
          additionalProperties: { $ref: "#/components/schemas/content_transfer_json" },
        },
        manifestVersion: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 128,
          pattern: npContentTransferPluginVersionPattern,
        },
      },
    },
    content_transfer_collections: {
      type: "object",
      additionalProperties: false,
      maxProperties: npContentTransferContractLimits.collections,
      properties: Object.fromEntries(
        slugs.map((slug) => [
          slug,
          {
            type: "array",
            maxItems: npContentTransferContractLimits.documentsPerCollection,
            items: { $ref: `#/components/schemas/${slug}_document` },
          },
        ]),
      ),
      description: `At most ${npContentTransferContractLimits.documentsTotal.toString()} documents total. Keys are limited to collections registered on this target.`,
    },
    content_transfer_partial_envelope: {
      type: "object",
      additionalProperties: false,
      required: contentTransferBaseRequired,
      properties: { ...contentTransferBaseProperties, partial: { type: "boolean", enum: [true] } },
    },
    content_transfer_full_envelope: {
      type: "object",
      additionalProperties: false,
      required: [
        ...contentTransferBaseRequired,
        "site",
        "theme",
        "settings",
        "navigation",
        "plugins",
      ],
      properties: {
        ...contentTransferBaseProperties,
        partial: { type: "boolean", enum: [false] },
        site: { $ref: "#/components/schemas/site_general_settings" },
        theme: { oneOf: [{ type: "null" }, themeTokensOverlaySchema] },
        settings: {
          allOf: [{ $ref: "#/components/schemas/framework_settings" }],
          maxProperties: npContentTransferContractLimits.settings,
        },
        navigation: {
          type: "object",
          maxProperties: npContentTransferContractLimits.navigationLocations,
          propertyNames: {
            maxLength: npNavigationLimits.locationLength,
            pattern: npNavigationLocationPattern,
          },
          additionalProperties: { $ref: "#/components/schemas/navigation_items" },
        },
        plugins: {
          type: "array",
          maxItems: npContentTransferContractLimits.plugins,
          items: { $ref: "#/components/schemas/content_transfer_plugin_state" },
        },
      },
    },
    content_transfer_envelope: {
      oneOf: [
        { $ref: "#/components/schemas/content_transfer_full_envelope" },
        { $ref: "#/components/schemas/content_transfer_partial_envelope" },
      ],
      description: `Exact v3 content-transfer envelope; serialized request/response size is capped at ${npContentTransferContractLimits.bodyBytes.toString()} bytes.`,
    },
    content_transfer_import_counts: {
      type: "object",
      additionalProperties: false,
      required: [
        "site",
        "theme",
        "settings",
        "navigation",
        "documentsCreated",
        "documentsUpdated",
        "mediaMatched",
        "pluginsUpdated",
      ],
      properties: {
        site: { type: "integer", minimum: 0, maximum: 1 },
        theme: { type: "integer", minimum: 0, maximum: 1 },
        settings: {
          type: "integer",
          minimum: 0,
          maximum: npContentTransferContractLimits.settings,
        },
        navigation: {
          type: "integer",
          minimum: 0,
          maximum: npContentTransferContractLimits.navigationLocations,
        },
        documentsCreated: {
          type: "integer",
          minimum: 0,
          maximum: npContentTransferContractLimits.documentsTotal,
        },
        documentsUpdated: {
          type: "integer",
          minimum: 0,
          maximum: npContentTransferContractLimits.documentsTotal,
        },
        mediaMatched: {
          type: "integer",
          minimum: 0,
          maximum: npContentTransferContractLimits.mediaItems,
        },
        pluginsUpdated: {
          type: "integer",
          minimum: 0,
          maximum: npContentTransferContractLimits.plugins,
        },
      },
      description: `Created plus updated documents cannot exceed ${npContentTransferContractLimits.documentsTotal.toString()}.`,
    },
    content_transfer_import_report: {
      type: "object",
      additionalProperties: false,
      required: ["imported", "warnings", "dryRun", "partial"],
      properties: {
        imported: { $ref: "#/components/schemas/content_transfer_import_counts" },
        warnings: {
          type: "array",
          maxItems: npContentTransferContractLimits.warnings,
          items: { type: "string", maxLength: npContentTransferContractLimits.warningLength },
        },
        dryRun: { type: "boolean" },
        partial: { type: "boolean" },
      },
      allOf: [
        {
          if: { properties: { partial: { const: true } }, required: ["partial"] },
          then: {
            properties: {
              imported: {
                properties: {
                  site: { const: 0 },
                  theme: { const: 0 },
                  settings: { const: 0 },
                  navigation: { const: 0 },
                  pluginsUpdated: { const: 0 },
                },
              },
            },
          },
          else: {
            properties: {
              imported: { properties: { site: { const: 1 }, theme: { const: 1 } } },
            },
          },
        },
      ],
    },
    discovery_json: {
      oneOf: [
        { type: "string", maxLength: npDiscoveryContractLimits.jsonStringLength },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        {
          type: "array",
          maxItems: npDiscoveryContractLimits.jsonArrayItems,
          items: { $ref: "#/components/schemas/discovery_json" },
        },
        {
          type: "object",
          maxProperties: npDiscoveryContractLimits.jsonObjectKeys,
          additionalProperties: { $ref: "#/components/schemas/discovery_json" },
        },
      ],
    },
    discovery_option: {
      type: "object",
      additionalProperties: false,
      required: ["label", "value"],
      properties: { label: { type: "string" }, value: { type: "string" } },
    },
    collection_discovery_field: {
      type: "object",
      additionalProperties: false,
      required: ["name", "type", "source"],
      properties: {
        name: { type: "string" },
        type: {
          type: "string",
          enum: [
            "text",
            "textarea",
            "number",
            "richText",
            "blocks",
            "checkbox",
            "date",
            "upload",
            "relationship",
            "select",
            "radio",
            "email",
            "json",
            "array",
            "group",
            "row",
            "collapsible",
          ],
        },
        source: { type: "string" },
        label: { type: "string" },
        description: { type: "string" },
        required: { type: "boolean" },
        defaultValue: { $ref: "#/components/schemas/discovery_json" },
        options: {
          type: "array",
          items: { $ref: "#/components/schemas/discovery_option" },
        },
        relationTo: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
        hasMany: { type: "boolean" },
        integerOnly: { type: "boolean" },
        fields: {
          type: "array",
          items: { $ref: "#/components/schemas/collection_discovery_field" },
        },
      },
    },
    collection_discovery_item: {
      type: "object",
      additionalProperties: false,
      required: [
        "slug",
        "source",
        "labels",
        "slug_auto",
        "i18n",
        "timestamps",
        "versions",
        "fields",
      ],
      properties: {
        slug: { type: "string" },
        source: { type: "string" },
        labels: {
          type: "object",
          additionalProperties: false,
          required: ["singular", "plural"],
          properties: { singular: { type: "string" }, plural: { type: "string" } },
        },
        description: { type: "string" },
        slug_auto: { type: "boolean" },
        i18n: { type: "boolean" },
        timestamps: { type: "boolean" },
        versions: {
          type: "object",
          additionalProperties: false,
          required: ["drafts"],
          properties: {
            drafts: { type: "boolean" },
            max: { type: "integer", minimum: 1 },
          },
        },
        fields: {
          type: "array",
          items: { $ref: "#/components/schemas/collection_discovery_field" },
        },
      },
    },
    collection_discovery_response: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/collection_discovery_item" },
        },
      },
    },
    block_discovery_rich_text_node: {
      type: "object",
      required: ["type", "version"],
      properties: {
        type: {
          type: "string",
          minLength: 1,
          maxLength: npDiscoveryContractLimits.jsonStringLength,
        },
        version: { type: "integer", minimum: 1 },
        children: {
          type: "array",
          maxItems: npDiscoveryContractLimits.jsonArrayItems,
          items: { $ref: "#/components/schemas/block_discovery_rich_text_node" },
        },
        text: { type: "string", maxLength: npDiscoveryContractLimits.jsonStringLength },
      },
      maxProperties: npDiscoveryContractLimits.jsonObjectKeys,
      additionalProperties: { $ref: "#/components/schemas/discovery_json" },
    },
    block_discovery_rich_text_content: {
      type: "object",
      additionalProperties: false,
      required: ["version", "document"],
      properties: {
        version: { type: "integer", const: 1 },
        document: {
          type: "object",
          additionalProperties: false,
          required: ["root"],
          properties: {
            root: {
              type: "object",
              additionalProperties: false,
              required: ["type", "children", "direction", "format", "indent", "version"],
              properties: {
                type: { type: "string", const: "root" },
                children: {
                  type: "array",
                  maxItems: npDiscoveryContractLimits.jsonArrayItems,
                  items: { $ref: "#/components/schemas/block_discovery_rich_text_node" },
                },
                direction: { type: ["string", "null"], enum: ["ltr", "rtl", null] },
                format: {
                  type: "string",
                  maxLength: npDiscoveryContractLimits.jsonStringLength,
                },
                indent: { type: "integer", minimum: 0 },
                version: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
    },
    block_discovery_condition: {
      type: "array",
      prefixItems: [
        {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z_][A-Za-z0-9_-]*$",
        },
        {
          oneOf: [
            { type: "string", maxLength: npDiscoveryContractLimits.jsonStringLength },
            { type: "number" },
            { type: "boolean" },
          ],
        },
      ],
      minItems: 2,
      maxItems: 2,
    },
    block_discovery_prop_field: {
      type: "object",
      discriminator: { propertyName: "type" },
      oneOf: [
        blockPropVariant("text", ["translatable"], {
          translatable: { type: "boolean" },
          defaultValue: blockStringDefault,
          placeholder: blockMetadataText(200),
          ...blockPropPatternProperties(),
        }),
        blockPropVariant("textarea", ["translatable"], {
          translatable: { type: "boolean" },
          defaultValue: blockStringDefault,
          placeholder: blockMetadataText(200),
          rows: { type: "integer", minimum: 1 },
        }),
        blockPropVariant("number", [], {
          defaultValue: { type: "number" },
          placeholder: blockMetadataText(200),
          min: { type: "number" },
          max: { type: "number" },
          step: { type: "number", exclusiveMinimum: 0 },
          validationMessage: blockMetadataText(300),
        }),
        blockPropVariant("boolean", [], { defaultValue: { type: "boolean" } }),
        blockPropVariant("select", ["options"], {
          defaultValue: blockStringDefault,
          options: {
            type: "array",
            minItems: 1,
            maxItems: npDiscoveryContractLimits.fields,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "value"],
              properties: {
                label: blockMetadataText(100),
                value: blockMetadataText(200),
              },
            },
          },
        }),
        blockPropVariant("url", [], {
          defaultValue: blockStringDefault,
          placeholder: blockMetadataText(200),
          ...blockPropPatternProperties(),
        }),
        blockPropVariant("richtext", ["translatable"], {
          translatable: { type: "boolean" },
          defaultValue: { $ref: "#/components/schemas/block_discovery_rich_text_content" },
        }),
        blockPropVariant("image", [], { defaultValue: blockStringDefault }),
        blockPropVariant("color", [], { defaultValue: blockStringDefault }),
        blockPropVariant("collection", [], { defaultValue: blockStringDefault }),
        blockPropVariant("array", ["itemSchema"], {
          defaultValue: {
            type: "array",
            maxItems: npDiscoveryContractLimits.jsonArrayItems,
            items: {
              type: "object",
              maxProperties: npDiscoveryContractLimits.jsonObjectKeys,
              additionalProperties: { $ref: "#/components/schemas/discovery_json" },
            },
          },
          itemSchema: {
            type: "array",
            maxItems: npDiscoveryContractLimits.fields,
            items: { $ref: "#/components/schemas/block_discovery_prop_field" },
          },
          itemDefault: {
            type: "object",
            maxProperties: npDiscoveryContractLimits.jsonObjectKeys,
            additionalProperties: { $ref: "#/components/schemas/discovery_json" },
          },
        }),
      ],
    },
    block_discovery_item: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "label",
        "source",
        "keywords",
        "defaultProps",
        "propsSchema",
        "acceptsChildren",
        "summaryFields",
        "allowedChildTypes",
      ],
      properties: {
        type: { type: "string" },
        label: { type: "string" },
        source: { type: "string" },
        description: { type: "string" },
        icon: { type: "string" },
        iconKind: { type: "string", enum: ["lucide", "emoji"] },
        category: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
        defaultProps: {
          type: "object",
          maxProperties: npDiscoveryContractLimits.jsonObjectKeys,
          additionalProperties: { $ref: "#/components/schemas/discovery_json" },
        },
        propsSchema: {
          type: "array",
          maxItems: npDiscoveryContractLimits.fields,
          items: { $ref: "#/components/schemas/block_discovery_prop_field" },
        },
        acceptsChildren: { type: "boolean" },
        summaryFields: { type: "array", items: { type: "string" } },
        allowedChildTypes: { type: "array", items: { type: "string" } },
        minChildren: { type: "integer", minimum: 0 },
        maxChildren: { type: "integer", minimum: 0 },
      },
    },
    block_discovery_response: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: { type: "array", items: { $ref: "#/components/schemas/block_discovery_item" } },
      },
    },
    plugin_discovery_item: {
      type: "object",
      additionalProperties: false,
      required: [
        "apiVersion",
        "legacy",
        "id",
        "name",
        "version",
        "description",
        "author",
        "license",
        "nexpress",
        "capabilities",
        "allowedHosts",
        "requires",
        "provides",
        "agent",
        "usesTokens",
        "styleSlots",
        "hooks",
        "routes",
        "pageRoutes",
        "scheduledTasks",
        "actions",
      ],
      properties: {
        apiVersion: { type: ["string", "null"], enum: ["1", null] },
        legacy: { type: "boolean" },
        id: { type: "string" },
        name: { type: "string" },
        version: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
        author: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["name"],
              properties: { name: { type: "string" }, url: { type: "string", format: "uri" } },
            },
          ],
        },
        license: { type: ["string", "null"] },
        nexpress: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["minVersion", "maxVersion"],
              properties: {
                minVersion: { type: "string" },
                maxVersion: { type: ["string", "null"] },
              },
            },
          ],
        },
        capabilities: { type: "array", items: { type: "string" } },
        allowedHosts: { type: "array", items: { type: "string" } },
        requires: { type: "array", items: { type: "string" } },
        provides: {
          type: "object",
          additionalProperties: false,
          required: [...npPluginDiscoveryProvideKeys],
          properties: Object.fromEntries(
            npPluginDiscoveryProvideKeys.map((key) => [
              key,
              {
                type: "array",
                maxItems: npDiscoveryContractLimits.fields,
                items: { type: "string" },
              },
            ]),
          ),
        },
        agent: {
          type: "object",
          additionalProperties: false,
          required: ["description", "category", "tags"],
          properties: {
            description: { type: "string" },
            category: { type: ["string", "null"] },
            tags: { type: "array", items: { type: "string" } },
            configSchema: {
              type: "object",
              additionalProperties: { $ref: "#/components/schemas/discovery_json" },
            },
          },
        },
        usesTokens: { type: "array", items: { type: "string" } },
        styleSlots: { type: "object", additionalProperties: { type: "string" } },
        hooks: { type: "array", items: { type: "string" } },
        routes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["method", "path", "auth"],
            properties: {
              method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
              path: { type: "string" },
              description: { type: "string" },
              auth: { type: "boolean" },
            },
          },
        },
        pageRoutes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["pattern", "surface", "locale"],
            properties: {
              pattern: { type: "string" },
              surface: { type: "string", enum: ["site", "member"] },
              locale: { type: "string", enum: ["auto", "none"] },
            },
          },
        },
        scheduledTasks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "cron"],
            properties: {
              id: { type: "string" },
              cron: { type: "string" },
              description: { type: "string" },
            },
          },
        },
        actions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "source"],
            properties: {
              id: { type: "string" },
              kind: { type: "string", enum: ["action", "metric", "status", "table"] },
              source: { type: "string", enum: ["definition", "setup"] },
              description: { type: "string" },
            },
          },
        },
      },
    },
    plugin_discovery_response: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: { type: "array", items: { $ref: "#/components/schemas/plugin_discovery_item" } },
      },
    },
    site_runtime_settings: {
      type: "object",
      additionalProperties: false,
      required: ["siteUrl", "defaultLocale", "timezone"],
      properties: {
        siteUrl: { type: ["string", "null"], format: "uri" },
        defaultLocale: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.localeLength,
        },
        timezone: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.timezoneLength,
        },
      },
    },
    site_record: {
      type: "object",
      additionalProperties: false,
      oneOf: [
        {
          properties: {
            id: { const: "default" },
            isDefault: { const: true },
          },
        },
        {
          properties: {
            id: { not: { const: "default" } },
            isDefault: { const: false },
          },
        },
      ],
      required: [
        "id",
        "name",
        "hostname",
        "description",
        "settings",
        "isDefault",
        "createdAt",
        "updatedAt",
      ],
      properties: {
        id: { type: "string", pattern: npSiteIdPattern },
        name: { type: "string", minLength: 1, maxLength: npSettingsContractLimits.siteNameLength },
        hostname: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.hostnameLength,
        },
        description: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.descriptionLength,
        },
        settings: { $ref: "#/components/schemas/site_runtime_settings" },
        isDefault: { type: "boolean" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    site_summary: {
      type: "object",
      additionalProperties: false,
      oneOf: [
        {
          properties: {
            id: { const: "default" },
            isDefault: { const: true },
          },
        },
        {
          properties: {
            id: { not: { const: "default" } },
            isDefault: { const: false },
          },
        },
      ],
      required: ["id", "name", "hostname", "isDefault"],
      properties: {
        id: { type: "string", pattern: npSiteIdPattern },
        name: { type: "string", minLength: 1, maxLength: npSettingsContractLimits.siteNameLength },
        hostname: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.hostnameLength,
        },
        isDefault: { type: "boolean" },
      },
    },
    site_create_input: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name"],
      properties: {
        id: {
          type: "string",
          pattern: npSiteIdPattern,
          not: { enum: ["default"] },
        },
        name: { type: "string", minLength: 1, maxLength: npSettingsContractLimits.siteNameLength },
        hostname: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.hostnameLength,
        },
        description: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.descriptionLength,
        },
        settings: { $ref: "#/components/schemas/site_runtime_settings" },
      },
    },
    site_update_input: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        name: { type: "string", minLength: 1, maxLength: npSettingsContractLimits.siteNameLength },
        hostname: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.hostnameLength,
        },
        description: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.descriptionLength,
        },
        settings: { $ref: "#/components/schemas/site_runtime_settings" },
      },
    },
    site_membership: {
      type: "object",
      additionalProperties: false,
      required: ["siteId", "userId", "role", "createdAt", "updatedAt"],
      properties: {
        siteId: { type: "string", pattern: npSiteIdPattern },
        userId: { type: "string", pattern: npUserIdPattern, format: "uuid" },
        role: { type: "string", enum: [...npUserRoles] },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    site_membership_grant_input: {
      type: "object",
      additionalProperties: false,
      required: ["userId", "role"],
      properties: {
        userId: { type: "string", pattern: npUserIdPattern, format: "uuid" },
        role: { type: "string", enum: [...npUserRoles] },
      },
    },
    site_usage: {
      type: "object",
      additionalProperties: false,
      required: [
        "collections",
        "settings",
        "navigation",
        "slugHistory",
        "memberships",
        "stringOverrides",
        "pluginStorage",
        "comments",
        "reactions",
        "follows",
        "mutes",
        "notifications",
        "reports",
        "auditEvents",
        "bans",
        "memberRoles",
        "total",
      ],
      properties: {
        collections: {
          type: "object",
          additionalProperties: { type: "integer", minimum: 0 },
        },
        ...Object.fromEntries(
          [
            "settings",
            "navigation",
            "slugHistory",
            "memberships",
            "stringOverrides",
            "pluginStorage",
            "comments",
            "reactions",
            "follows",
            "mutes",
            "notifications",
            "reports",
            "auditEvents",
            "bans",
            "memberRoles",
            "total",
          ].map((key) => [key, { type: "integer", minimum: 0 }]),
        ),
      },
    },
    site_general_settings: {
      type: "object",
      additionalProperties: false,
      required: ["name", "url", "description", "defaultLocale", "timezone"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: npSettingsContractLimits.siteNameLength,
        },
        url: {
          type: ["string", "null"],
          format: "uri",
          maxLength: npSettingsContractLimits.urlLength,
          description: "HTTP(S) origin without credentials, path, query, or hash.",
        },
        description: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.descriptionLength,
        },
        defaultLocale: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.localeLength,
        },
        timezone: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.timezoneLength,
        },
      },
    },
    seo_settings: {
      type: "object",
      additionalProperties: false,
      required: ["defaultOgImage", "twitterHandle", "defaultLocale"],
      properties: {
        defaultOgImage: {
          type: ["string", "null"],
          maxLength: npSettingsContractLimits.urlLength,
        },
        twitterHandle: {
          type: ["string", "null"],
          pattern: "^[A-Za-z0-9_]{1,15}$",
        },
        defaultLocale: {
          type: "string",
          minLength: 2,
          maxLength: npSettingsContractLimits.localeLength,
        },
      },
    },
    admin_settings_snapshot: {
      type: "object",
      additionalProperties: false,
      required: ["site", "seo"],
      properties: {
        site: { $ref: "#/components/schemas/site_general_settings" },
        seo: { $ref: "#/components/schemas/seo_settings" },
      },
    },
    versioned_settings_envelope: {
      type: "object",
      additionalProperties: false,
      required: ["__npVersion", "__npSettings"],
      properties: {
        __npVersion: { type: "integer", minimum: 1, maximum: 1_000_000 },
        __npSettings: {
          description: "Bounded JSON validated again by the registered owner schema.",
        },
      },
    },
    community_settings: {
      type: "object",
      additionalProperties: false,
      required: ["reactionKinds", "registrationEnabled", "memberUploadQuota"],
      properties: {
        reactionKinds: {
          type: "array",
          maxItems: 32,
          uniqueItems: true,
          items: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,29}$" },
        },
        registrationEnabled: { type: "boolean" },
        memberUploadQuota: {
          type: "object",
          additionalProperties: false,
          required: ["perDay", "total"],
          properties: {
            perDay: { type: ["integer", "null"], minimum: 0, maximum: 1_000_000 },
            total: { type: ["integer", "null"], minimum: 0, maximum: 1_000_000 },
          },
        },
      },
    },
    saved_page_pattern: {
      type: "object",
      additionalProperties: false,
      required: ["id", "label", "blocks", "createdAt", "updatedAt"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 160 },
        label: { type: "string", minLength: 1, maxLength: 160 },
        description: { type: "string", maxLength: 1000 },
        blocks: { type: "array", items: { $ref: "#/components/schemas/block_instance" } },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    framework_settings: {
      type: "object",
      additionalProperties: false,
      properties: {
        seo: { $ref: "#/components/schemas/seo_settings" },
        community: { $ref: "#/components/schemas/community_settings" },
        activeTheme: { type: "string", pattern: npDynamicSettingOwnerPattern },
        "page-builder.patterns": {
          type: "array",
          maxItems: 200,
          items: { $ref: "#/components/schemas/saved_page_pattern" },
        },
      },
      patternProperties: {
        [`^theme\\.settings:${npDynamicSettingOwnerPattern.slice(1, -1)}$`]: {
          $ref: "#/components/schemas/versioned_settings_envelope",
        },
      },
    },
    block_layout: {
      type: "object",
      additionalProperties: false,
      required: ["colSpan"],
      properties: {
        colSpan: { type: "integer", minimum: 1, maximum: 12 },
        mdColSpan: { type: "integer", minimum: 1, maximum: 12 },
        lgColSpan: { type: "integer", minimum: 1, maximum: 12 },
      },
    },
    block_instance: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "props"],
      properties: {
        id: {
          type: "string",
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        },
        type: {
          type: "string",
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
        },
        props: { type: "object", additionalProperties: true },
        layout: { $ref: "#/components/schemas/block_layout" },
        children: {
          type: "array",
          items: { $ref: "#/components/schemas/block_instance" },
        },
      },
    },
    navigation_item: {
      description: `Exact persisted navigation item. Trees support ${npNavigationLimits.maxDepth.toString()} levels and ${npNavigationLimits.maxItems.toString()} total items per location.`,
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "type", "url"],
          properties: {
            id: {
              type: "string",
              maxLength: npNavigationLimits.itemIdLength,
              pattern: npNavigationItemIdPattern,
            },
            label: { type: "string", minLength: 1, maxLength: npNavigationLimits.labelLength },
            type: { type: "string", enum: ["link"] },
            url: { type: "string", minLength: 1, maxLength: npNavigationLimits.urlLength },
            children: {
              type: "array",
              maxItems: npNavigationLimits.maxItems,
              items: { $ref: "#/components/schemas/navigation_item" },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "type", "collection"],
          properties: {
            id: {
              type: "string",
              maxLength: npNavigationLimits.itemIdLength,
              pattern: npNavigationItemIdPattern,
            },
            label: { type: "string", minLength: 1, maxLength: npNavigationLimits.labelLength },
            type: { type: "string", enum: ["collection"] },
            collection: {
              type: "string",
              maxLength: npNavigationLimits.collectionSlugLength,
              pattern: npNavigationCollectionSlugPattern,
            },
            children: {
              type: "array",
              maxItems: npNavigationLimits.maxItems,
              items: { $ref: "#/components/schemas/navigation_item" },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "type", "pageId"],
          properties: {
            id: {
              type: "string",
              maxLength: npNavigationLimits.itemIdLength,
              pattern: npNavigationItemIdPattern,
            },
            label: { type: "string", minLength: 1, maxLength: npNavigationLimits.labelLength },
            type: { type: "string", enum: ["page"] },
            pageId: {
              type: "string",
              maxLength: npNavigationLimits.itemIdLength,
              pattern: npNavigationItemIdPattern,
            },
            collectionSlug: {
              type: "string",
              maxLength: npNavigationLimits.collectionSlugLength,
              pattern: npNavigationCollectionSlugPattern,
            },
            children: {
              type: "array",
              maxItems: npNavigationLimits.maxItems,
              items: { $ref: "#/components/schemas/navigation_item" },
            },
          },
        },
      ],
    },
    navigation_items: {
      type: "array",
      maxItems: npNavigationLimits.maxItems,
      items: { $ref: "#/components/schemas/navigation_item" },
    },
    navigation_location: {
      type: "string",
      maxLength: npNavigationLimits.locationLength,
      pattern: npNavigationLocationPattern,
    },
    navigation_payload: {
      type: "object",
      additionalProperties: false,
      required: ["location", "items", "updatedAt"],
      properties: {
        location: { $ref: "#/components/schemas/navigation_location" },
        items: { $ref: "#/components/schemas/navigation_items" },
        updatedAt: { type: ["string", "null"], format: "date-time" },
      },
    },
    plugin_item: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        version: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
        capabilities: { type: "array", items: { type: "string" } },
        hooks: { type: "array", items: { type: "string" } },
        routes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              method: { type: "string" },
              path: { type: "string" },
            },
          },
        },
        enabled: { type: "boolean" },
        config: { type: "object", additionalProperties: true },
        installedAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        loaded: {
          type: "boolean",
          description:
            "True when the plugin is currently registered in this process (may lag the DB flag until restart).",
        },
      },
    },
    user_item: {
      type: "object",
      additionalProperties: false,
      required: ["id", "email", "name", "role", "avatar", "createdAt", "updatedAt"],
      properties: {
        id: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        email: {
          type: "string",
          format: "email",
          maxLength: npAuthContractLimits.emailLength,
        },
        name: { type: "string", minLength: 1, maxLength: npAuthContractLimits.nameLength },
        role: { type: "string", enum: [...npUserRoles] },
        avatar: { type: ["string", "null"], format: "uuid" },
        createdAt: {
          type: "string",
          format: "date-time",
          pattern: npAuthCanonicalDatePattern,
        },
        updatedAt: {
          type: "string",
          format: "date-time",
          pattern: npAuthCanonicalDatePattern,
        },
      },
    },
    staff_session_user: {
      type: "object",
      additionalProperties: false,
      required: ["id", "email", "name", "role"],
      properties: {
        id: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        email: {
          type: "string",
          format: "email",
          maxLength: npAuthContractLimits.emailLength,
        },
        name: { type: "string", minLength: 1, maxLength: npAuthContractLimits.nameLength },
        role: { type: "string", enum: [...npUserRoles] },
      },
    },
    member_session_user: {
      type: "object",
      additionalProperties: false,
      required: ["id", "handle", "email", "displayName"],
      properties: {
        id: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        handle: { type: "string", pattern: npMemberHandlePattern },
        email: {
          type: "string",
          format: "email",
          maxLength: npAuthContractLimits.emailLength,
        },
        displayName: {
          type: "string",
          minLength: 1,
          maxLength: npAuthContractLimits.displayNameLength,
        },
      },
    },
    member_self: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "handle",
        "email",
        "displayName",
        "emailVerified",
        "avatar",
        "bio",
        "status",
        "reputation",
        "createdAt",
      ],
      properties: {
        id: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        handle: { type: "string", pattern: npMemberHandlePattern },
        email: {
          type: "string",
          format: "email",
          maxLength: npAuthContractLimits.emailLength,
        },
        displayName: {
          type: "string",
          minLength: 1,
          maxLength: npAuthContractLimits.displayNameLength,
        },
        emailVerified: { type: "boolean" },
        avatar: { type: ["string", "null"], format: "uuid" },
        bio: { type: ["string", "null"], maxLength: npAuthContractLimits.bioLength },
        status: { type: "string", enum: ["active"] },
        reputation: { type: "integer" },
        createdAt: {
          type: "string",
          format: "date-time",
          pattern: npAuthCanonicalDatePattern,
        },
      },
    },
    media_item: {
      type: "object",
      additionalProperties: false,
      description:
        "Exact Admin media API record. Persisted image variants live on `sizes`; public URLs are resolved through the active storage adapter under `urls`.",
      required: [
        "id",
        "filename",
        "originalFilename",
        "mimeType",
        "filesize",
        "width",
        "height",
        "alt",
        "caption",
        "focalPoint",
        "sizes",
        "storageKey",
        "hash",
        "status",
        "folderId",
        "uploadedBy",
        "uploadedByMemberId",
        "createdAt",
        "updatedAt",
        "deletedAt",
        "urls",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        filename: { type: "string", minLength: 1, maxLength: npMediaContractLimits.filenameLength },
        originalFilename: {
          type: "string",
          minLength: 1,
          maxLength: npMediaContractLimits.filenameLength,
        },
        mimeType: { type: "string", minLength: 3, maxLength: npMediaContractLimits.mimeTypeLength },
        filesize: { type: "integer", minimum: 0 },
        width: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: npMediaContractLimits.maxStoredDimension,
        },
        height: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: npMediaContractLimits.maxStoredDimension,
        },
        alt: { type: ["string", "null"], maxLength: npMediaContractLimits.textLength },
        caption: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["version", "document"],
              properties: {
                version: { type: "integer", enum: [1] },
                document: {
                  type: "object",
                  additionalProperties: false,
                  required: ["root"],
                  properties: {
                    root: {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "children", "direction", "format", "indent", "version"],
                      properties: {
                        type: { type: "string", enum: ["root"] },
                        children: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["type", "version"],
                            additionalProperties: true,
                          },
                        },
                        direction: { type: ["string", "null"], enum: ["ltr", "rtl", null] },
                        format: { type: "string" },
                        indent: { type: "integer", minimum: 0 },
                        version: { type: "integer", minimum: 1 },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
        focalPoint: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["x", "y"],
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          ],
        },
        hash: {
          type: "string",
          pattern: "^[0-9a-f]{64}$",
          description: "Content SHA used for dedup on import.",
        },
        folderId: { type: ["string", "null"], format: "uuid" },
        uploadedBy: { type: ["string", "null"], format: "uuid" },
        uploadedByMemberId: { type: ["string", "null"], format: "uuid" },
        storageKey: {
          type: "string",
          minLength: 1,
          maxLength: npMediaContractLimits.storageKeyLength,
          pattern: npMediaStorageKeyPattern,
        },
        sizes: {
          oneOf: [
            { type: "null" },
            {
              type: "object",
              maxProperties: npMediaContractLimits.maxVariants,
              propertyNames: { pattern: npMediaVariantNamePattern },
              additionalProperties: { $ref: "#/components/schemas/media_variant" },
            },
          ],
        },
        status: { type: "string", enum: [...npMediaStatuses] },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        deletedAt: { type: ["string", "null"], format: "date-time" },
        urls: { $ref: "#/components/schemas/media_resolved_urls" },
        uploader: {
          oneOf: [
            { type: "null" },
            { $ref: "#/components/schemas/media_staff_uploader" },
            { $ref: "#/components/schemas/media_member_uploader" },
          ],
        },
      },
    },
    media_attachment: {
      type: "object",
      additionalProperties: false,
      description:
        "Exact client-safe attachment descriptor. Storage keys and uploader identity are intentionally omitted.",
      required: ["id", "filename", "mimeType", "filesize", "status", "downloadUrl"],
      properties: {
        id: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
        filename: {
          type: "string",
          minLength: 1,
          maxLength: npMediaAttachmentLimits.filenameLength,
          pattern:
            "^(?!\\s)(?!.*\\s$)[^/\\\\\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]+$",
          description: `Safe basename with one supported extension: ${npMediaAttachmentExtensions.join(", ")}.`,
        },
        mimeType: {
          type: "string",
          enum: [...new Set(Object.values(npMediaAttachmentMimeTypes))],
        },
        filesize: {
          type: "integer",
          minimum: 1,
          maximum: npMediaAttachmentLimits.maxFileSizeBytes,
        },
        status: { type: "string", enum: [...npMediaAttachmentStatuses] },
        downloadUrl: {
          type: "string",
          pattern: `^/api/media/attachments/${npAuthUuidPattern.slice(1, -1)}$`,
        },
      },
    },
    media_variant: {
      type: "object",
      additionalProperties: false,
      required: ["filename", "mimeType", "filesize", "width", "height", "storageKey"],
      properties: {
        filename: { type: "string", minLength: 1, maxLength: npMediaContractLimits.filenameLength },
        mimeType: {
          type: "string",
          pattern: "^image/",
          maxLength: npMediaContractLimits.mimeTypeLength,
        },
        filesize: { type: "integer", minimum: 1 },
        width: { type: "integer", minimum: 1, maximum: npMediaContractLimits.maxStoredDimension },
        height: { type: "integer", minimum: 1, maximum: npMediaContractLimits.maxStoredDimension },
        storageKey: {
          type: "string",
          minLength: 1,
          maxLength: npMediaContractLimits.storageKeyLength,
          pattern: npMediaStorageKeyPattern,
        },
      },
    },
    media_resolved_urls: {
      type: "object",
      additionalProperties: false,
      required: ["original", "thumbnail"],
      properties: {
        original: { type: "string", minLength: 1 },
        thumbnail: { type: ["string", "null"], minLength: 1 },
      },
    },
    media_staff_uploader: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "name", "email"],
      properties: {
        kind: { type: "string", enum: ["staff"] },
        name: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
      },
    },
    media_member_uploader: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "handle", "displayName"],
      properties: {
        kind: { type: "string", enum: ["member"] },
        handle: { type: "string", minLength: 1 },
        displayName: { type: ["string", "null"] },
      },
    },
    media_folder: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        parentId: { type: "string", format: "uuid", nullable: true },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    ...npCreateApiErrorOpenApiSchemas(),
  };
  const paths: Record<string, OpenApiSchema> = {
    "/api/auth/login": {
      post: {
        summary: "Log in with email and password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["email", "password"],
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                    maxLength: npAuthContractLimits.emailLength,
                  },
                  password: {
                    type: "string",
                    minLength: 1,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Creates one browser-session row, sets auth cookies, and returns the user",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["user"],
                  properties: { user: { $ref: "#/components/schemas/staff_session_user" } },
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        summary: "Revoke the current browser session and clear auth cookies",
        description:
          "Deletes every browser-session row named by a valid access or refresh token and its shared `sid`, then clears every staff auth cookie.",
        responses: { "200": { description: "Session revoked and cookies cleared" } },
      },
    },
    "/api/auth/me": {
      get: {
        summary: "Current authenticated user",
        responses: {
          "200": {
            description: "Exact staff session user",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["user"],
                  properties: { user: { $ref: "#/components/schemas/staff_session_user" } },
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/oauth/{provider}/start": {
      get: {
        summary: "Begin an OAuth login (staff side)",
        description:
          "Mints a signed `np-oauth-state` cookie and 302s the browser to the provider's authorize URL. Provider must be registered in-process via `registerOAuthProvider({ id, authorize, exchange })` from `@nexpress/core` — typically by a plugin's `setup()` — and must support the `staff` audience when it declares `audiences`.",
        parameters: [{ in: "path", name: "provider", required: true, schema: { type: "string" } }],
        responses: {
          "307": { description: "Redirect to provider authorize URL" },
          "404": { description: "Provider not registered" },
        },
      },
    },
    "/api/auth/oauth/{provider}/callback": {
      get: {
        summary: "Finish an OAuth login",
        description:
          "Validates the state cookie, calls the provider's `exchange()` for the normalized profile, then resolves the matching `np_users` row in this order: (1) durable `(provider, providerUserId)` link, (2) email-match link, (3) auto-provision new user with role `viewer`. On success sets `np-session` / `np-refresh` / `np-csrf` cookies and 302s to `/admin`. Failures redirect to `/admin/login?oauth_error=…` — never expose provider error text.",
        parameters: [
          { in: "path", name: "provider", required: true, schema: { type: "string" } },
          { in: "query", name: "code", required: true, schema: { type: "string" } },
          { in: "query", name: "state", required: true, schema: { type: "string" } },
        ],
        responses: {
          "307": {
            description:
              "Redirect — `/admin` on success or `/admin/login?oauth_error=…` on failure",
          },
        },
      },
    },
    "/api/members/oauth/{provider}/start": {
      get: {
        summary: "Begin an OAuth login (member side)",
        description:
          "Member-side mirror of `/api/auth/oauth/{provider}/start`. Mints a signed `np-mb-oauth-state` cookie and 302s to the provider. The provider registry is shared with the staff route, but providers that declare `audiences` must include `member`; providers without `audiences` stay visible on both surfaces for back-compat.",
        parameters: [{ in: "path", name: "provider", required: true, schema: { type: "string" } }],
        responses: {
          "307": { description: "Redirect to provider authorize URL" },
          "404": { description: "Provider not registered" },
        },
      },
    },
    "/api/members/oauth/{provider}/callback": {
      get: {
        summary: "Finish an OAuth login (member side)",
        description:
          "Validates `np-mb-oauth-state`, calls `provider.exchange()`, resolves the matching `np_members` row in this order: (1) durable `(provider, subject)` link in `np_member_identities`, (2) email-match link, (3) auto-provision a new member with `status='active'` and `email_verified=true`. On success persists one browser-session row containing both access and refresh hashes, sets `np-mb-session` / `np-mb-refresh` / `np-mb-csrf` cookies, and 302s to `/`. Any non-active member redirects to `/members/login?oauth_error=member_inactive`. Other failures redirect with `oauth_error=<code>` — never echo provider error text.",
        parameters: [
          { in: "path", name: "provider", required: true, schema: { type: "string" } },
          { in: "query", name: "code", required: true, schema: { type: "string" } },
          { in: "query", name: "state", required: true, schema: { type: "string" } },
        ],
        responses: {
          "307": {
            description: "Redirect — `/` on success or `/members/login?oauth_error=…` on failure",
          },
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        summary: "Exchange refresh token for a new session",
        description:
          "Reads `np-refresh` and compare-and-swap rotates both hashes on the same session id. A replayed refresh token is rejected.",
        responses: {
          "200": {
            description: "Fresh session + refresh + CSRF cookies; body contains the user",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["user"],
                  properties: { user: { $ref: "#/components/schemas/staff_session_user" } },
                },
              },
            },
          },
          "401": { description: "Refresh cookie missing, expired, or revoked" },
        },
      },
    },
    "/api/auth/change-password": {
      patch: {
        summary: "Change the current user's password",
        description:
          "Requires session cookie + CSRF header. Bumps `tokenVersion` so existing JWTs are invalidated; auth cookies are cleared on success — the client must log in again.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["currentPassword", "newPassword"],
                properties: {
                  currentPassword: {
                    type: "string",
                    minLength: 1,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                  newPassword: {
                    type: "string",
                    minLength: npAuthContractLimits.passwordMinLength,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Password changed" },
          "401": { description: "Current password incorrect" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/auth/forgot-password": {
      post: {
        summary: "Request a password-reset email",
        description:
          "Returns 200 regardless of whether the email matches a user — response is deliberately constant to avoid enumeration.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["email"],
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                    maxLength: npAuthContractLimits.emailLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Enqueued (may or may not have matched a user)" },
        },
      },
    },
    "/api/auth/reset-password": {
      post: {
        summary: "Consume a reset token and set a new password",
        description:
          "Bumps the user's tokenVersion and deletes all sessions so existing JWTs are invalidated.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["token", "password"],
                properties: {
                  token: {
                    type: "string",
                    minLength: 64,
                    maxLength: 64,
                    pattern: npAuthSingleUseTokenPattern,
                  },
                  password: {
                    type: "string",
                    minLength: npAuthContractLimits.passwordMinLength,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Password updated" },
          "400": { description: "Token invalid, expired, or password too short" },
        },
      },
    },
    "/api/users/invite": {
      post: {
        summary: "Create a new user and send them an invite link (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["email", "name", "role"],
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                    maxLength: npAuthContractLimits.emailLength,
                  },
                  name: {
                    type: "string",
                    minLength: 1,
                    maxLength: npAuthContractLimits.nameLength,
                  },
                  role: { type: "string", enum: [...npUserRoles] },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "User created; invite job enqueued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "email", "name", "role", "inviteExpiresAt"],
                  properties: {
                    id: { type: "string", format: "uuid", pattern: npAuthUuidPattern },
                    email: { type: "string", format: "email" },
                    name: { type: "string", minLength: 1 },
                    role: { type: "string", enum: [...npUserRoles] },
                    inviteExpiresAt: {
                      type: "string",
                      format: "date-time",
                      pattern: npAuthCanonicalDatePattern,
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Validation or duplicate email" },
          "403": { description: "Caller is not an admin" },
        },
      },
    },
    "/api/members/register": {
      post: {
        summary: "Self-register a public site member",
        description:
          "Creates a `pending` member, mints a 24h email verification token, and enqueues a verify email. Login refuses pending accounts until the token is consumed via `/api/members/verify`. Response is constant on success regardless of email/handle collision (anti-enumeration).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["email", "password", "handle", "displayName"],
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                    maxLength: npAuthContractLimits.emailLength,
                  },
                  password: {
                    type: "string",
                    minLength: npAuthContractLimits.passwordMinLength,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                  handle: {
                    type: "string",
                    minLength: 3,
                    maxLength: npAuthContractLimits.handleLength,
                    pattern: npMemberHandlePattern,
                  },
                  displayName: {
                    type: "string",
                    minLength: 1,
                    maxLength: npAuthContractLimits.displayNameLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Acknowledged. Email sent if the registration was new." },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/members/verify": {
      post: {
        summary: "Consume a member email verification token",
        description: "Flips a pending member to active. Token comes from the registration email.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["token"],
                properties: {
                  token: {
                    type: "string",
                    minLength: 64,
                    maxLength: 64,
                    pattern: npAuthSingleUseTokenPattern,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Verified" },
          "400": { description: "Invalid or expired token" },
        },
      },
    },
    "/api/members/login": {
      post: {
        summary: "Member login",
        description:
          "Creates one browser-session row and sets `np-mb-session` / `np-mb-refresh` / `np-mb-csrf` cookies. Refuses every non-active status with the same generic 401 used for wrong passwords (anti-enumeration).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["email", "password"],
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                    maxLength: npAuthContractLimits.emailLength,
                  },
                  password: {
                    type: "string",
                    minLength: 1,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Logged in; exact member session object in body and cookies set",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["member"],
                  properties: { member: { $ref: "#/components/schemas/member_session_user" } },
                },
              },
            },
          },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/api/members/refresh": {
      post: {
        summary: "Rotate member session",
        description:
          "Reads `np-mb-refresh` and compare-and-swap rotates both token hashes on the same session id. Replays are rejected.",
        responses: {
          "200": {
            description: "Fresh cookies and exact member session object",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["member"],
                  properties: { member: { $ref: "#/components/schemas/member_session_user" } },
                },
              },
            },
          },
          "401": { description: "Refresh cookie missing or invalid" },
        },
      },
    },
    "/api/members/logout": {
      post: {
        summary: "Member logout",
        description:
          "Deletes every browser-session row named by a valid access or refresh token and its shared `sid`, then clears all `np-mb-*` cookies.",
        responses: { "200": { description: "Logged out" } },
      },
    },
    "/api/members/me": {
      get: {
        summary: "Authenticated member profile",
        description: "Returns the full self-profile, including email and verification state.",
        responses: {
          "200": {
            description: "Exact member self-profile",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["member"],
                  properties: { member: { $ref: "#/components/schemas/member_self" } },
                },
              },
            },
          },
          "401": { description: "Not authenticated" },
        },
      },
      patch: {
        summary: "Update member profile",
        description:
          "Editable fields: `displayName`, `bio`, `avatar`. Including `newPassword` requires `currentPassword`; on success the response carries `mustReauth: true` and clears auth cookies.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                minProperties: 1,
                properties: {
                  displayName: {
                    type: "string",
                    minLength: 1,
                    maxLength: npAuthContractLimits.displayNameLength,
                  },
                  bio: {
                    type: ["string", "null"],
                    maxLength: npAuthContractLimits.bioLength,
                  },
                  avatar: { type: ["string", "null"], format: "uuid" },
                  newPassword: {
                    type: "string",
                    minLength: npAuthContractLimits.passwordMinLength,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                  currentPassword: {
                    type: "string",
                    minLength: 1,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated" },
          "400": { description: "Validation error" },
          "401": { description: "Not authenticated" },
        },
      },
      delete: {
        summary: "Soft-delete the authenticated member",
        description:
          "Sets `status='deleted'` and anonymises identifying columns (display_name, email, handle) so the row's unique constraints free up the originals. Sessions revoked, password nulled, cookies cleared.",
        responses: {
          "200": { description: "Deleted" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/api/members/forgot-password": {
      post: {
        summary: "Request a member password reset email",
        description: "Constant 200 regardless of whether the email matched a member.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["email"],
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                    maxLength: npAuthContractLimits.emailLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Acknowledged" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/members/reset-password": {
      post: {
        summary: "Consume a member reset token + set a new password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["token", "password"],
                properties: {
                  token: {
                    type: "string",
                    minLength: 64,
                    maxLength: 64,
                    pattern: npAuthSingleUseTokenPattern,
                  },
                  password: {
                    type: "string",
                    minLength: npAuthContractLimits.passwordMinLength,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Password updated" },
          "400": { description: "Token invalid, expired, or password too short" },
        },
      },
    },
    "/api/members/{handle}": {
      parameters: [{ in: "path", name: "handle", required: true, schema: { type: "string" } }],
      get: {
        summary: "Public member profile by handle",
        description:
          "Returns the exact PII-free public profile contract with a resolved avatar URL. Pending, suspended, and deleted handles return 404; imported public profiles remain visible.",
        responses: {
          "200": {
            description: "Exact public member profile",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/community_public_member_profile" },
              },
            },
          },
          "404": { description: "No active member with that handle" },
        },
      },
    },
    "/api/members/{handle}/activity": {
      parameters: [{ in: "path", name: "handle", required: true, schema: { type: "string" } }],
      get: {
        summary: "List a member's public activity",
        description:
          "Returns exact site-scoped pages from collection-authorized public profile projections. Documents must be published/public; comments must be visible beneath a published/public target.",
        parameters: [
          {
            in: "query",
            name: "kind",
            schema: { type: "string", enum: ["documents", "comments"], default: "documents" },
          },
          {
            in: "query",
            name: "page",
            schema: { type: "integer", minimum: 1, maximum: 10_000, default: 1 },
          },
          {
            in: "query",
            name: "limit",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: npCommunityContractLimits.profileActivityPageRows,
              default: 20,
            },
          },
        ],
        responses: {
          "200": {
            description: "Exact public member activity page",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/community_member_profile_activity_page" },
              },
            },
          },
          "400": { description: "Malformed or out-of-range activity query" },
          "404": { description: "No public member with that handle" },
        },
      },
    },
    "/api/users": {
      get: {
        summary: "List users (editor+)",
        parameters: [
          {
            in: "query",
            name: "page",
            schema: { type: "integer", minimum: 1, maximum: 10_000 },
          },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          {
            in: "query",
            name: "search",
            schema: { type: "string" },
            description: "Matches against email and name.",
          },
        ],
        responses: {
          "200": {
            description: "Paged user list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "docs",
                    "totalDocs",
                    "totalPages",
                    "page",
                    "limit",
                    "hasNextPage",
                    "hasPrevPage",
                  ],
                  properties: {
                    docs: { type: "array", items: { $ref: "#/components/schemas/user_item" } },
                    totalDocs: { type: "integer" },
                    totalPages: { type: "integer" },
                    page: { type: "integer" },
                    limit: { type: "integer" },
                    hasNextPage: { type: "boolean" },
                    hasPrevPage: { type: "boolean" },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not editor or above" },
        },
      },
      post: {
        summary: "Create a user directly with a password (admin only)",
        description:
          "For inviting by email instead, use `POST /api/users/invite`. This endpoint takes a pre-set password and does not send a welcome email.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["email", "name", "password", "role"],
                properties: {
                  email: {
                    type: "string",
                    format: "email",
                    maxLength: npAuthContractLimits.emailLength,
                  },
                  name: {
                    type: "string",
                    minLength: 1,
                    maxLength: npAuthContractLimits.nameLength,
                  },
                  password: {
                    type: "string",
                    minLength: npAuthContractLimits.passwordMinLength,
                    maxLength: npAuthContractLimits.passwordMaxLength,
                  },
                  role: { type: "string", enum: [...npUserRoles] },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created user",
            content: { "application/json": { schema: { $ref: "#/components/schemas/user_item" } } },
          },
          "409": { description: "Email already registered" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/navigation": {
      get: {
        summary: "Get a navigation tree by location",
        security: [],
        parameters: [
          {
            in: "query",
            name: "location",
            schema: { $ref: "#/components/schemas/navigation_location" },
            description: "Defaults to `main`.",
          },
        ],
        responses: {
          "200": {
            description: "Navigation payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/navigation_payload" },
              },
            },
          },
        },
      },
      put: {
        summary: "Replace a navigation tree (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["items"],
                properties: {
                  location: {
                    $ref: "#/components/schemas/navigation_location",
                    description: "Defaults to `main`.",
                  },
                  items: { $ref: "#/components/schemas/navigation_items" },
                  expectedUpdatedAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated navigation payload" },
          "403": { description: "Caller is not an admin" },
          "400": { description: "Invalid items structure" },
        },
      },
      patch: {
        summary: "Rename a custom navigation location (admin only)",
        parameters: [
          {
            in: "query",
            name: "location",
            required: true,
            schema: { $ref: "#/components/schemas/navigation_location" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["newLocation"],
                properties: {
                  newLocation: { $ref: "#/components/schemas/navigation_location" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Renamed navigation payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/navigation_payload" },
              },
            },
          },
          "400": { description: "Invalid location" },
          "403": { description: "Protected location or caller is not an admin" },
          "409": { description: "Target location already exists" },
        },
      },
      delete: {
        summary: "Delete a custom navigation location (admin only)",
        parameters: [
          {
            in: "query",
            name: "location",
            required: true,
            schema: { $ref: "#/components/schemas/navigation_location" },
          },
        ],
        responses: {
          "200": { description: "Deleted location" },
          "400": { description: "Invalid location" },
          "403": { description: "Protected location or caller is not an admin" },
          "404": { description: "Location not found" },
        },
      },
    },
    "/api/settings": {
      get: {
        summary: "Canonical site identity and SEO settings (admin only)",
        responses: {
          "200": {
            description: "Exact site + SEO settings snapshot.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/admin_settings_snapshot" },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
        },
      },
      put: {
        summary: "Replace canonical site identity or SEO settings (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["key", "value"],
                    properties: {
                      key: { type: "string", enum: ["site"] },
                      value: { $ref: "#/components/schemas/site_general_settings" },
                    },
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["key", "value"],
                    properties: {
                      key: { type: "string", enum: ["seo"] },
                      value: { $ref: "#/components/schemas/seo_settings" },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated setting row",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["key", "value"],
                  properties: {
                    key: { type: "string", enum: ["site", "seo"] },
                    value: {
                      oneOf: [
                        { $ref: "#/components/schemas/site_general_settings" },
                        { $ref: "#/components/schemas/seo_settings" },
                      ],
                    },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "400": { description: "Unknown key, extra field, or value contract mismatch" },
        },
      },
    },
    "/api/settings/theme": {
      get: {
        summary: "Active theme tokens",
        description:
          "Public endpoint — returns the fully resolved framework defaults + active theme + persisted override token tree.",
        security: [],
        responses: {
          "200": {
            description: "Theme tokens",
            content: {
              "application/json": {
                schema: themeTokensSchema,
              },
            },
          },
        },
      },
      put: {
        summary: "Replace the theme tokens (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: themeTokensSchema,
            },
          },
        },
        responses: {
          "200": { description: "Updated theme; triggers public-site revalidation." },
          "403": { description: "Caller is not an admin" },
          "400": { description: "Theme token structure invalid" },
        },
      },
      patch: {
        summary: "Alias of PUT — replace the theme tokens (admin only)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: themeTokensSchema } },
        },
        responses: {
          "200": { description: "Updated theme; triggers public-site revalidation." },
          "403": { description: "Caller is not an admin" },
          "400": { description: "Theme token contract invalid" },
        },
      },
    },
    "/api/members/media/attachments": {
      post: {
        summary: "Upload a member attachment",
        description: `Accepts one file up to ${npMediaAttachmentLimits.maxFileSizeBytes.toString()} bytes. The safe extension, declared MIME type, and file signature must agree.`,
        security: [{ memberSessionCookie: [], memberCsrfHeader: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Attachment accepted; images may still be processing",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/media_attachment" },
              },
            },
          },
          "400": { description: "Unsafe name, unsupported type, mismatched bytes, or size limit" },
          "401": { description: "Active member session required" },
          "403": { description: "Member upload policy denied the request" },
          "429": { description: "Member upload quota exceeded" },
        },
      },
    },
    "/api/members/media/attachments/{id}": {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      delete: {
        summary: "Delete an unreferenced member attachment",
        description:
          "Only the member who uploaded the file may delete it. A document reference must be removed first.",
        security: [{ memberSessionCookie: [], memberCsrfHeader: [] }],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "deleted"],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    deleted: { type: "boolean", const: true },
                  },
                },
              },
            },
          },
          "401": { description: "Active member session required" },
          "404": { description: "Attachment not found or not owned by the caller" },
          "409": { description: "Attachment is still referenced by a document" },
        },
      },
    },
    "/api/media/attachments/{id}": {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      get: {
        summary: "Download an attachment",
        description:
          "Available to the uploader or when a published public document references the attachment. Responses always force download, disable sniffing, and use a sandbox CSP.",
        security: [],
        responses: {
          "200": {
            description: "Attachment bytes",
            headers: {
              "Content-Disposition": {
                description: "Always `attachment` with ASCII and RFC 5987 UTF-8 filenames.",
                schema: { type: "string" },
              },
              "X-Content-Type-Options": { schema: { type: "string", const: "nosniff" } },
              "Content-Security-Policy": {
                schema: {
                  type: "string",
                  const: "default-src 'none'; frame-ancestors 'none'; sandbox",
                },
              },
            },
            content: {
              "application/octet-stream": { schema: { type: "string", format: "binary" } },
            },
          },
          "404": { description: "Attachment absent or not visible to the caller" },
        },
      },
      head: {
        summary: "Inspect a downloadable attachment",
        description:
          "Uses the same owner/public-reference authorization and download headers as GET.",
        security: [],
        responses: {
          "200": { description: "Download headers without a response body" },
          "404": { description: "Attachment absent or not visible to the caller" },
        },
      },
    },
    "/api/media": {
      get: {
        summary: "List media",
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "folderId", schema: { type: "string", format: "uuid" } },
          {
            in: "query",
            name: "mimeType",
            schema: { type: "string" },
            description: "Exact MIME type match, e.g. `image/webp`.",
          },
          {
            in: "query",
            name: "q",
            schema: { type: "string" },
            description: "Filename and alt-text substring search.",
          },
          {
            in: "query",
            name: "uploaderKind",
            schema: { type: "string", enum: ["staff", "member"] },
          },
          { in: "query", name: "uploadedByMemberId", schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Paged media list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    docs: { type: "array", items: { $ref: "#/components/schemas/media_item" } },
                    totalDocs: { type: "integer" },
                    totalPages: { type: "integer" },
                    page: { type: "integer" },
                    limit: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/media/upload": {
      post: {
        summary: "Upload a file (editor+)",
        description:
          "Multipart form upload. Images are transcoded asynchronously — expect 202 while variants are generated. Max 10MB.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary" },
                  folderId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Non-image upload completed synchronously" },
          "202": { description: "Image accepted; variant generation running in a job" },
          "403": { description: "Caller is not editor or above" },
          "400": { description: "Unsupported MIME / file too large / folder not found" },
        },
      },
    },
    "/api/media/{id}": {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      get: {
        summary: "Get a single media record",
        responses: {
          "200": {
            description: "Media record",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/media_item" } },
            },
          },
          "404": { description: "Media not found" },
        },
      },
      delete: {
        summary: "Delete a media record (admin only)",
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" }, deleted: { type: "boolean" } },
                },
              },
            },
          },
          "404": { description: "Media not found" },
          "409": { description: "Media is referenced by a document — clear refs first." },
        },
      },
    },
    "/api/media/folders": {
      get: {
        summary: "List media folders",
        parameters: [
          {
            in: "query",
            name: "parentId",
            schema: { type: "string", format: "uuid" },
            description: "Omit to list top-level folders.",
          },
        ],
        responses: {
          "200": {
            description: "Folder array",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/media_folder" } },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a folder (editor+)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  parentId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created folder",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/media_folder" } },
            },
          },
          "404": { description: "Parent folder not found" },
          "400": { description: "name missing" },
        },
      },
    },
    "/api/media/folders/{id}": {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      patch: {
        summary: "Rename a folder (editor+)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated folder",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/media_folder" } },
            },
          },
          "404": { description: "Folder not found" },
        },
      },
      delete: {
        summary: "Delete a folder (admin only)",
        responses: {
          "204": { description: "Deleted" },
          "404": { description: "Folder not found" },
          "409": { description: "Folder has media or child folders" },
        },
      },
    },
    "/api/meta/blocks": {
      get: {
        summary: "Block manifests registered in this instance",
        description:
          "Public exact discovery endpoint for the process-wide shared registry, including enabled plugin and configured theme ownership.",
        security: [],
        responses: {
          "200": {
            description: "Block manifest list",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/block_discovery_response",
                },
              },
            },
          },
        },
      },
    },
    "/api/meta/collections": {
      get: {
        summary: "Collection manifests registered in this instance",
        description:
          "Public exact discovery endpoint for resolved collection and field metadata. Server-only access callbacks and hooks are omitted.",
        security: [],
        responses: {
          "200": {
            description: "Collection manifest list",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/collection_discovery_response",
                },
              },
            },
          },
        },
      },
    },
    "/api/meta/plugins": {
      get: {
        summary: "Plugin manifests loaded in this process",
        description:
          "Public exact manifest metadata plus actual runtime inventories. Config values, author email, handlers, and callbacks are omitted.",
        security: [],
        responses: {
          "200": {
            description: "Plugin manifest list",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/plugin_discovery_response",
                },
              },
            },
          },
        },
      },
    },
    "/api/preview": {
      get: {
        summary: "Enable Next.js draft mode and redirect (editor+)",
        parameters: [
          {
            in: "query",
            name: "path",
            schema: { type: "string" },
            description: "Where to redirect once draft mode is enabled. Defaults to `/`.",
          },
        ],
        responses: {
          "307": { description: "Redirect to the target path with draft cookies set" },
          "403": { description: "Caller is not editor or above" },
        },
      },
    },
    "/api/preview/exit": {
      get: {
        summary: "Disable draft mode and redirect to /",
        responses: { "307": { description: "Redirect" } },
      },
    },
    "/api/plugins/{pluginId}/actions/{actionId}": {
      parameters: [
        { in: "path", name: "pluginId", required: true, schema: { type: "string" } },
        { in: "path", name: "actionId", required: true, schema: { type: "string" } },
      ],
      post: {
        summary: "Dispatch a plugin action (admin only)",
        description:
          "Invokes an action from the plugin's definition-level `actions` registry or setup-time `ctx.actions.register*` API. Body is forwarded to the handler; widget/action shapes pass `{ collection, documentId }` for collection tabs, or an empty body for global widgets.",
        requestBody: {
          required: false,
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        responses: {
          "200": {
            description: "Handler result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    data: {},
                    error: { type: "string" },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "404": { description: "Plugin or action not found" },
        },
      },
    },
    "/api/health": {
      get: {
        summary: "Liveness probe",
        responses: {
          "200": {
            description: "Always-on health payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok"] },
                    timestamp: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/export": {
      get: {
        summary: "Export all content + settings as a single JSON document (admin only)",
        description:
          "Produces the exact bounded v3 envelope accepted by `POST /api/import`. Full export includes site, theme, portable settings, navigation, every selected collection's exact wire documents, definition-owned media references (metadata, not binary objects), and plugin enabled/config state. Pass `?collections=posts,pages` to produce a closed partial content-only envelope. Export fails rather than truncating a collection or returning malformed persisted state.",
        parameters: [
          {
            in: "query",
            name: "collections",
            schema: {
              type: "string",
              pattern: contentTransferCollectionFilterPattern,
              maxLength:
                npContentTransferContractLimits.collections *
                  (npContentTransferContractLimits.collectionSlugLength + 1) -
                1,
            },
            description:
              "Comma-separated slug list. When present, only these collections export and the non-content sections (theme/settings/navigation/plugins) are skipped.",
          },
        ],
        responses: {
          "200": {
            description: "Export payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/content_transfer_envelope" },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "400": { description: "Unknown collection slug in filter" },
        },
      },
    },
    "/api/import": {
      post: {
        summary: "Import a prior `/api/export` payload (admin only)",
        description:
          "Validates the complete exact v3 envelope, active collection definitions, schema-owned media references, document identities, relationships, themes, and plugin config before mutation. Source document UUIDs are preserved, so repeated imports update the same rows. New relationship targets are ordered before their sources; new cycles fail. Database mutations share one transaction. Plugin/theme code and media binaries are not transferred.\n\nPass the exact string `?dryRun=true` to run the same preflight and counts without writing. Pass `?collections=a,b` to project selected content from either envelope; full-site sections are then ignored with a warning.",
        parameters: [
          {
            in: "query",
            name: "dryRun",
            schema: { type: "string", enum: ["true", "false"] },
            description:
              "When `true`, skip all writes and return the report that would have been generated.",
          },
          {
            in: "query",
            name: "collections",
            schema: {
              type: "string",
              pattern: contentTransferCollectionFilterPattern,
              maxLength:
                npContentTransferContractLimits.collections *
                  (npContentTransferContractLimits.collectionSlugLength + 1) -
                1,
            },
            description:
              "Comma-separated slug list. When present, only these collections import and theme/settings/navigation/plugins are skipped.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/content_transfer_envelope" },
            },
          },
        },
        responses: {
          "200": {
            description: "Import report",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/content_transfer_import_report" },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
          "400": {
            description:
              "Invalid payload shape, unsupported version, or unknown collection in filter",
          },
        },
      },
    },
    "/api/search": {
      get: {
        summary: "Full-text search across published documents in every collection",
        description:
          'Public, current-site endpoint. Unknown or duplicate query parameters and ambiguous page/offset pairs are rejected. Uses the installed exact search adapter or the built-in Postgres search_vector path; every result is revalidated as status="published" and visibility="public", and audience-aware collection results must additionally expose audience="public" before they are returned.',
        parameters: [
          {
            in: "query",
            name: "q",
            required: true,
            schema: { type: "string", maxLength: npSearchContractLimits.queryLength },
            description: "NFKC-normalized query. May be empty, but must be present exactly once.",
          },
          {
            in: "query",
            name: "collections",
            schema: {
              type: "string",
              maxLength: npSearchContractLimits.collectionsQueryLength,
              pattern: `${npSearchCollectionSlugPattern.slice(0, -1)}(?:,${npSearchCollectionSlugPattern.slice(1, -1)})*$`,
            },
            description: `Canonical comma-separated collection slugs without padding, empties, or duplicates; at most ${npSearchContractLimits.collectionCount.toString()}. Omit to search every registered collection with a search_vector column.`,
          },
          {
            in: "query",
            name: "limit",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: npSearchContractLimits.limit,
              default: 10,
            },
          },
          {
            in: "query",
            name: "page",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: npSearchContractLimits.offset + 1,
            },
            description:
              "1-based page number. Mutually exclusive with offset; the selected limit must keep the computed offset at or below the documented offset maximum.",
          },
          {
            in: "query",
            name: "offset",
            schema: {
              type: "integer",
              minimum: 0,
              maximum: npSearchContractLimits.offset,
              default: 0,
            },
          },
          {
            in: "query",
            name: "locale",
            schema: {
              type: "string",
              minLength: 2,
              maxLength: npSearchContractLimits.localeLength,
            },
            description: "Canonical configured BCP 47 locale.",
          },
        ],
        responses: {
          "200": {
            description: "Globally relevance-ranked search results.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "results",
                    "total",
                    "perCollection",
                    "facets",
                    "limit",
                    "offset",
                    "hasNextPage",
                  ],
                  properties: {
                    results: {
                      type: "array",
                      maxItems: npSearchContractLimits.limit,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["collection", "doc"],
                        properties: {
                          collection: {
                            type: "string",
                            pattern: npSearchCollectionSlugPattern,
                            maxLength: npSearchContractLimits.collectionSlugLength,
                          },
                          doc: {
                            type: "object",
                            required: ["id", "siteId", "status", "visibility"],
                            properties: {
                              id: {
                                type: "string",
                                minLength: 1,
                                maxLength: npSearchContractLimits.resultDocumentIdLength,
                              },
                              siteId: { type: "string", pattern: npSiteIdPattern },
                              status: { const: "published" },
                              visibility: { const: "public" },
                              audience: {
                                const: "public",
                                description:
                                  "Required for collections that opt into the document audience contract; omitted by collections without that field.",
                              },
                            },
                            additionalProperties: true,
                          },
                          score: {
                            type: "number",
                            description:
                              "Adapter-defined relative relevance score. Ordering is authoritative; the scale is not stable.",
                          },
                        },
                      },
                    },
                    total: { type: "integer", minimum: 0 },
                    perCollection: {
                      type: "object",
                      propertyNames: { pattern: npSearchCollectionSlugPattern },
                      additionalProperties: { type: "integer", minimum: 0 },
                    },
                    facets: {
                      type: "array",
                      maxItems: npSearchContractLimits.collectionCount,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["collection", "label", "count", "selected"],
                        properties: {
                          collection: { type: "string", pattern: npSearchCollectionSlugPattern },
                          label: {
                            type: "string",
                            minLength: 1,
                            maxLength: npSearchContractLimits.facetLabelLength,
                          },
                          count: { type: "integer", minimum: 0 },
                          selected: { const: true },
                        },
                      },
                    },
                    limit: {
                      type: "integer",
                      minimum: 1,
                      maximum: npSearchContractLimits.limit,
                    },
                    offset: {
                      type: "integer",
                      minimum: 0,
                      maximum: npSearchContractLimits.offset,
                    },
                    hasNextPage: { type: "boolean" },
                  },
                },
              },
            },
          },
          "400": {
            description:
              "Missing, duplicate, unknown, non-canonical, unconfigured, or over-budget search query.",
          },
        },
      },
    },
    "/api/plugins": {
      get: {
        summary: "List installed plugins with enabled state + registry info (admin only)",
        responses: {
          "200": {
            description: "Plugin list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/plugin_item" },
                    },
                  },
                },
              },
            },
          },
          "403": { description: "Caller is not an admin" },
        },
      },
    },
    "/api/plugins/{pluginId}": {
      parameters: [{ in: "path", name: "pluginId", required: true, schema: { type: "string" } }],
      get: {
        summary: "Get a single plugin (admin only)",
        responses: {
          "200": {
            description: "Plugin detail",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/plugin_item" } },
            },
          },
          "404": { description: "Plugin id unknown" },
        },
      },
      patch: {
        summary: "Enable/disable a plugin or update its config (admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  enabled: { type: "boolean" },
                  config: { type: "object", additionalProperties: true },
                },
                description: "At least one of `enabled` or `config` must be provided.",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated plugin",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/plugin_item" } },
            },
          },
          "404": { description: "Plugin id unknown" },
        },
      },
    },
  };

  for (const slug of slugs) {
    const config = getCollectionConfig(slug);
    const manifest = collectionToManifest(config);
    const schemaName = `${slug}_document`;
    const createSchemaName = `${slug}_create_input`;
    const patchSchemaName = `${slug}_patch_input`;
    schemas[schemaName] = collectionDocumentSchema(manifest, config);
    schemas[createSchemaName] = collectionWriteSchema(manifest, config, false);
    schemas[patchSchemaName] = collectionWriteSchema(manifest, config, true);

    paths[`/api/collections/${slug}`] = {
      get: {
        summary: `List ${manifest.labels.plural.toLowerCase()}`,
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "sort", schema: { type: "string" } },
          { in: "query", name: "search", schema: { type: "string" } },
          {
            in: "query",
            name: "where",
            schema: { type: "string", description: "JSON-encoded filter object" },
          },
          ...(config.i18n
            ? [
                {
                  in: "query",
                  name: "locale",
                  schema: {
                    type: "string",
                    maxLength: npCollectionContractLimits.localeLength,
                  },
                },
              ]
            : []),
        ],
        responses: {
          "200": {
            description: "Paged result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "docs",
                    "totalDocs",
                    "totalPages",
                    "page",
                    "limit",
                    "hasNextPage",
                    "hasPrevPage",
                  ],
                  properties: {
                    docs: { type: "array", items: { $ref: `#/components/schemas/${schemaName}` } },
                    totalDocs: { type: "integer", minimum: 0 },
                    totalPages: { type: "integer", minimum: 0 },
                    page: { type: "integer", minimum: 1 },
                    limit: { type: "integer", minimum: 1, maximum: 100 },
                    hasNextPage: { type: "boolean" },
                    hasPrevPage: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: `Create a ${manifest.labels.singular.toLowerCase()}`,
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${createSchemaName}` } },
          },
        },
        responses: {
          "201": {
            description: "Created document",
            content: {
              "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
            },
          },
        },
      },
    };

    paths[`/api/collections/${slug}/{id}`] = {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      get: {
        summary: `Get a single ${manifest.labels.singular.toLowerCase()}`,
        responses: {
          "200": {
            description: "Document",
            content: {
              "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
            },
          },
        },
      },
      patch: {
        summary: `Update a ${manifest.labels.singular.toLowerCase()}`,
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${patchSchemaName}` } },
          },
        },
        responses: {
          "200": {
            description: "Updated document",
            content: {
              "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
            },
          },
        },
      },
      delete: {
        summary: `Delete a ${manifest.labels.singular.toLowerCase()}`,
        responses: { "204": { description: "Deleted" } },
      },
    };

    if (config.community?.moderation) {
      paths[`/api/collections/${slug}/{id}/moderation`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
        ],
        post: {
          summary: `Moderate a ${manifest.labels.singular.toLowerCase()} as a scoped member moderator`,
          description:
            "Applies one declared thread transition after resolving site, collection, category, and thread scopes. Lock/pin actions are available only when the collection maps the corresponding checkbox field.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["action"],
                  properties: {
                    action: { type: "string", enum: [...npCommunityThreadModerationActions] },
                    reason: {
                      type: ["string", "null"],
                      minLength: 1,
                      maxLength: npCommunityContractLimits.reasonLength,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "{ ok: true }" },
            "400": { description: "Unsupported action or invalid current state" },
            "401": { description: "Member auth required" },
            "403": { description: "The member lacks the required capability in this scope" },
            "404": { description: "Document not found" },
          },
        },
      };
    }

    paths[`/api/collections/${slug}/bulk`] = {
      post: {
        summary: `Bulk publish / unpublish / delete ${manifest.labels.plural.toLowerCase()}`,
        description:
          "Loops the requested action over each id, returning a per-id success/failure list so the caller can surface partial failures. Capped at 100 ids per request.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action", "ids"],
                properties: {
                  action: { type: "string", enum: ["publish", "unpublish", "delete"] },
                  ids: {
                    type: "array",
                    items: { type: "string", format: "uuid" },
                    minItems: 1,
                    maxItems: 100,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Per-id outcome",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    succeeded: { type: "array", items: { type: "string", format: "uuid" } },
                    failed: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          error: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid action, empty/oversized ids array, or non-UUID id" },
          "401": { description: "Caller not authenticated" },
          "403": { description: "Caller lacks permission for the action on this collection" },
        },
      },
    };

    if (config.versions) {
      const snapshotSchema = revisionSnapshotSchema(manifest, config);
      const drafts = config.versions?.drafts;
      if (typeof drafts === "object" && drafts.autosave === true) {
        paths[`/api/collections/${slug}/{id}/autosave`] = {
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          post: {
            summary: `Autosave a ${manifest.labels.singular.toLowerCase()} draft`,
            description:
              "Persists the request body as a `status=autosave` revision without touching the main document row. Editor clients call this on a debounce so a crash mid-edit can be recovered from the revisions panel. Requires `versions.drafts.autosave === true` on the collection.",
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: snapshotSchema },
              },
            },
            responses: {
              "200": {
                description:
                  "Exact autosave result. saved=false identifies a deduplicated snapshot.",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      additionalProperties: false,
                      required: ["saved", "revisionId", "version"],
                      properties: {
                        saved: { type: "boolean" },
                        revisionId: { type: "string", format: "uuid" },
                        version: { type: "integer", minimum: 1 },
                      },
                    },
                  },
                },
              },
              "400": { description: "Autosave not configured for this collection" },
              "404": { description: "Document not found" },
            },
          },
        };
      }

      const revisionSummary: OpenApiSchema = {
        type: "object",
        additionalProperties: false,
        required: ["id", "version", "status", "changedFields", "authorId", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          version: { type: "integer", minimum: 1 },
          status: { type: "string", enum: [...NP_REVISION_STATUSES] },
          changedFields: { type: "array", uniqueItems: true, items: { type: "string" } },
          authorId: { type: ["string", "null"], format: "uuid" },
          createdAt: {
            type: "string",
            format: "date-time",
            pattern: npRevisionCanonicalDatePattern,
          },
        },
      };

      paths[`/api/collections/${slug}/{id}/revisions`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          summary: `List revisions for a ${manifest.labels.singular.toLowerCase()}`,
          parameters: [
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
          ],
          responses: {
            "200": {
              description: "Paged revisions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["revisions", "total"],
                    properties: {
                      revisions: { type: "array", items: revisionSummary },
                      total: { type: "integer", minimum: 0 },
                    },
                  },
                },
              },
            },
          },
        },
      };

      paths[`/api/collections/${slug}/{id}/revisions/{revisionId}`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          {
            in: "path",
            name: "revisionId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        get: {
          summary: `Get a single revision with snapshot`,
          responses: {
            "200": {
              description: "Revision with full snapshot",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "id",
                      "version",
                      "status",
                      "changedFields",
                      "authorId",
                      "createdAt",
                      "snapshot",
                    ],
                    properties: {
                      ...(revisionSummary.properties as Record<string, OpenApiSchema>),
                      snapshot: snapshotSchema,
                    },
                  },
                },
              },
            },
          },
        },
      };

      paths[`/api/collections/${slug}/{id}/revisions/{revisionId}/restore`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          {
            in: "path",
            name: "revisionId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        post: {
          summary: `Restore a prior revision as the current document`,
          responses: {
            "200": {
              description: "Document after restore",
              content: {
                "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
              },
            },
          },
        },
      };
    }

    // Comment routes — only listed when the collection opted in.
    if (getCollectionConfig(slug).community?.comments) {
      paths[`/api/collections/${slug}/{id}/comments`] = {
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          summary: `List comments under a ${manifest.labels.singular.toLowerCase()}`,
          parameters: [
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
            { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
            {
              in: "query",
              name: "order",
              schema: { type: "string", enum: ["newest", "oldest", "top"] },
            },
            {
              in: "query",
              name: "includeHidden",
              schema: { type: "string", enum: ["1"] },
              description: "Include hidden comments (mod-only; require an active member session).",
            },
          ],
          responses: {
            "200": {
              description: "Paged comment list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/community_comment_list" },
                },
              },
            },
          },
        },
        post: {
          summary: `Post a comment on a ${manifest.labels.singular.toLowerCase()}`,
          description:
            "Member auth + CSRF required. Body is markdown (limited subset — bold, italic, inline + fenced code, allow-listed http(s)/mailto links). Server stores both the markdown source and the rendered HTML.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["bodyMd"],
                  properties: {
                    bodyMd: { type: "string", maxLength: 5000 },
                    parentId: { type: "string", format: "uuid", nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created comment",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/community_comment_row" },
                },
              },
            },
            "400": { description: "Comments disabled for this collection or invalid body" },
            "401": { description: "Member auth required" },
            "404": { description: "parentId not found or doesn't belong to this document" },
          },
        },
      };
    }
  }

  // Per-comment endpoints (live regardless of collection — comment id
  // already carries the target context).
  paths[`/api/comments/{id}`] = {
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
    ],
    patch: {
      summary: "Edit a comment (own or with edit-any-comment grant)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["bodyMd"],
              properties: { bodyMd: { type: "string", maxLength: 5000 } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated comment",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_comment_row" },
            },
          },
        },
        "401": { description: "Member auth required" },
        "403": { description: "No permission" },
      },
    },
    delete: {
      summary: "Soft-delete a comment (own or with delete-any-comment grant)",
      responses: {
        "200": {
          description: "Deleted (status='deleted', body cleared)",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/community_ok" } },
          },
        },
        "401": { description: "Member auth required" },
        "403": { description: "No permission" },
      },
    },
  };
  paths["/api/comments/{id}/hide"] = {
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
    ],
    post: {
      summary: "Hide a comment (mod-only)",
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { reason: { type: "string", nullable: true } },
            },
          },
        },
      },
      responses: {
        "200": { description: "Hidden" },
        "403": { description: "Caller lacks hide-comment for this scope" },
      },
    },
  };
  paths["/api/comments/{id}/restore"] = {
    parameters: [
      { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
    ],
    post: {
      summary: "Restore a hidden comment (mod-only)",
      responses: {
        "200": { description: "Visible again" },
        "400": { description: "Comment is not hidden" },
        "403": { description: "Caller lacks restore-comment for this scope" },
      },
    },
  };

  paths["/api/reactions"] = {
    get: {
      summary: "Reaction summary for a target",
      parameters: [
        {
          in: "query",
          name: "targetType",
          required: true,
          schema: {
            type: "string",
            minLength: 1,
            maxLength: 63,
            pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
          },
          description:
            "Use `comment` or a collection slug whose config enables `community.reactions`.",
        },
        {
          in: "query",
          name: "targetId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          in: "query",
          name: "kind",
          schema: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,29}$" },
          description: "Defaults to `like`.",
        },
      ],
      responses: {
        "200": {
          description: "{counts: { kind: count }, mine: kinds[]}",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["counts", "mine"],
                properties: {
                  counts: {
                    type: "object",
                    additionalProperties: { type: "integer", minimum: 0 },
                  },
                  mine: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      summary: "React to a target (idempotent)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["targetType", "targetId"],
              properties: {
                targetType: {
                  type: "string",
                  minLength: 1,
                  maxLength: 63,
                  pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
                },
                targetId: { type: "string", format: "uuid" },
                kind: {
                  type: "string",
                  pattern: "^[a-z][a-z0-9_-]{0,29}$",
                  description: "Defaults to `like`.",
                },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Created (or returned existing if duplicate)" },
        "400": { description: "Invalid target or document reactions are disabled" },
        "401": { description: "Member auth required" },
      },
    },
    delete: {
      summary: "Remove a reaction",
      parameters: [
        {
          in: "query",
          name: "targetType",
          required: true,
          schema: {
            type: "string",
            minLength: 1,
            maxLength: 63,
            pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
          },
        },
        {
          in: "query",
          name: "targetId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          in: "query",
          name: "kind",
          schema: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,29}$" },
        },
      ],
      responses: {
        "200": { description: "Reaction removed (no-op if it didn't exist)" },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/views"] = {
    post: {
      summary: "Record a daily-unique public document view",
      description:
        "Anonymous and CSRF-exempt. A first-party HttpOnly visitor cookie is hashed before Core receives it, then scoped again to the site, target, and UTC day for persistence; raw cookies, stable cross-document visitor identifiers, IP addresses, and user agents are not stored. The target collection must enable `community.views`.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["targetType", "targetId"],
              properties: {
                targetType: {
                  type: "string",
                  minLength: 1,
                  maxLength: 63,
                  pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
                },
                targetId: { type: "string", format: "uuid" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Whether this visitor/day was counted and the current target total",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["counted", "viewCount"],
                properties: {
                  counted: { type: "boolean" },
                  viewCount: { type: "integer", minimum: 0 },
                },
              },
            },
          },
        },
        "400": { description: "Invalid target or document views are disabled" },
        "404": { description: "Public target document not found" },
        "429": { description: "Anonymous write rate limit exceeded" },
      },
    },
  };
  paths["/api/follows"] = {
    get: {
      summary: "List the authenticated member's follows",
      parameters: [
        {
          in: "query",
          name: "targetType",
          schema: {
            type: "string",
            pattern: npSearchCollectionSlugPattern,
            maxLength: 63,
          },
          description: "`member` or a canonical collection slug with `community.follows` enabled.",
        },
        { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
      ],
      responses: {
        "200": {
          description: "Follow rows",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_follow_list" },
            },
          },
        },
        "401": { description: "Member auth required" },
      },
    },
    post: {
      summary: "Follow a member or subscribe to a public collection document",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["targetType", "targetId"],
              properties: {
                targetType: {
                  type: "string",
                  pattern: npSearchCollectionSlugPattern,
                  maxLength: 63,
                  description:
                    "`member` or a canonical collection slug with `community.follows` enabled.",
                },
                targetId: { type: "string", format: "uuid" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Followed (or existing follow returned on duplicate)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_follow_row" },
            },
          },
        },
        "400": { description: "Self-follow or collection document follows are disabled" },
        "404": { description: "Active member or public document target not found" },
      },
    },
    delete: {
      summary: "Unfollow",
      parameters: [
        {
          in: "query",
          name: "targetType",
          required: true,
          schema: { type: "string", pattern: npSearchCollectionSlugPattern, maxLength: 63 },
          description: "`member` or a canonical collection slug.",
        },
        {
          in: "query",
          name: "targetId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": {
          description: "Removed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_ok" },
            },
          },
        },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/follows/check"] = {
    get: {
      summary: "Probe whether the authenticated member follows a single target",
      description:
        "Single-target probe used by site UI follow buttons. The bulk `/api/follows` returns the caller's full follow list, which is the wrong shape for one-button use.",
      parameters: [
        {
          in: "query",
          name: "targetType",
          required: true,
          schema: { type: "string", pattern: npSearchCollectionSlugPattern, maxLength: 63 },
        },
        {
          in: "query",
          name: "targetId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": {
          description: "Current follow state",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_following" },
            },
          },
        },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/notifications"] = {
    get: {
      summary: "Authenticated member's notification inbox",
      parameters: [
        {
          in: "query",
          name: "count",
          schema: { type: "string", enum: ["1"] },
          description: "Lightweight badge probe — returns just `{ unread }`.",
        },
        {
          in: "query",
          name: "unread",
          schema: { type: "string", enum: ["1"] },
          description: "Filter the list to unread rows.",
        },
        { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        { in: "query", name: "offset", schema: { type: "integer", minimum: 0 } },
      ],
      responses: {
        "200": { description: "Notification list + unread count" },
        "401": { description: "Member auth required" },
      },
    },
  };
  paths["/api/notifications/mark-read"] = {
    post: {
      summary: "Mark notifications read",
      description:
        "Two modes: `{ all: true }` marks every unread row read; `{ ids: [...] }` (≤ 200) marks the listed ids only. Ids that don't belong to the caller silently no-op.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                all: { type: "boolean" },
                ids: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 200 },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "{ marked: number, all?: boolean }" },
        "400": { description: "Validation error" },
      },
    },
  };

  paths["/api/reports"] = {
    post: {
      summary: "File a community report",
      description:
        "Members report a visible comment, an active member, or a public document whose collection enables `community.reports`. Document targets use the canonical collection slug. A member can have only one unresolved report per site and target; duplicate open filings return 409.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["targetType", "targetId", "reason"],
              properties: {
                targetType: {
                  ...communityTargetTypeSchema,
                  description: "Reserved `comment` / `member` target or a collection slug.",
                },
                targetId: { type: "string", format: "uuid" },
                reason: reportRowProperties.reason,
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Report row",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_report_row" },
            },
          },
        },
        "400": { description: "Validation error" },
        "401": { description: "Member auth required" },
        "409": { description: "The member already has an unresolved report for this target" },
      },
    },
  };
  paths["/api/reports/{id}/resolve"] = {
    post: {
      summary: "Resolve a report as a scoped member moderator",
      description:
        "Requires `resolve-report` on the report target's projected category, collection, thread, or site scope. The action remains constrained by the report target kind.",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["action"],
              properties: {
                action: { type: "string", enum: [...npCommunityReportResolutionActions] },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated report row",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_report_row" },
            },
          },
        },
        "400": { description: "Already resolved, incompatible action, or invalid target state" },
        "401": { description: "Member auth required" },
        "403": { description: "The member lacks resolve-report in this target scope" },
        "404": { description: "Report or target not found" },
      },
    },
  };
  paths["/api/admin/community/reports"] = {
    get: {
      summary: "List moderation reports (staff/mod only)",
      parameters: [
        {
          in: "query",
          name: "status",
          schema: { type: "string", enum: ["unresolved", "resolved", "all"] },
          description: "Default: `unresolved`.",
        },
        {
          in: "query",
          name: "targetType",
          schema: communityTargetTypeSchema,
        },
        { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
      ],
      responses: {
        "200": {
          description:
            "Paginated report list with exact operator-safe target context, status, excerpt, and Admin link",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_moderation_report_page" },
            },
          },
        },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/community/reports/{id}/resolve"] = {
    post: {
      summary: "Resolve a moderation report",
      description:
        "Applies one target-compatible moderation action and resolves the report under a report-row lock. `hide-comment` hides a visible comment; `unpublish-document` moves a report-enabled document to pending review; `dismiss` changes only the report.",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["action"],
              properties: {
                action: {
                  type: "string",
                  enum: [...npCommunityReportResolutionActions],
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated report row",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_report_row" },
            },
          },
        },
        "400": { description: "Already resolved or validation error" },
        "403": { description: "Requires admin / editor / moderator role" },
        "404": { description: "Report not found" },
      },
    },
  };
  paths["/api/admin/community/bans"] = {
    get: {
      summary: "List active bans for a member",
      parameters: [
        {
          in: "query",
          name: "memberId",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": { description: "Active ban rows for the member" },
        "400": { description: "memberId required" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
    post: {
      summary: "Issue a ban",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["memberId", "scopeType"],
              properties: {
                memberId: { type: "string", format: "uuid" },
                scopeType: { type: "string", enum: ["site", "category", "collection"] },
                scopeId: {
                  type: "string",
                  nullable: true,
                  description: "Required for non-site scopes.",
                },
                kind: { type: "string", enum: ["temporary", "permanent"] },
                expiresAt: {
                  type: "string",
                  format: "date-time",
                  description: "Required when kind=temporary.",
                },
                reason: { type: "string", nullable: true },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Ban row" },
        "400": { description: "Validation error" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/community/bans/{id}"] = {
    delete: {
      summary: "Revoke a ban",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": { description: "{ ok: true }" },
        "403": { description: "Requires admin / editor / moderator role" },
        "404": { description: "Ban not found" },
      },
    },
  };
  paths["/api/admin/community/comments/{id}"] = {
    delete: {
      summary: "Staff delete a comment",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": { description: "{ ok: true }" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/community/comments/{id}/hide"] = {
    post: {
      summary: "Staff hide a comment",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", properties: { reason: { type: "string" } } },
          },
        },
      },
      responses: {
        "200": { description: "{ ok: true }" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/community/comments/{id}/restore"] = {
    post: {
      summary: "Staff restore a comment",
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": { description: "{ ok: true }" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/audit"] = {
    get: {
      summary: "Read the moderation audit log",
      parameters: [
        { in: "query", name: "targetType", schema: { type: "string" } },
        { in: "query", name: "targetId", schema: { type: "string", format: "uuid" } },
        { in: "query", name: "actorUserId", schema: { type: "string", format: "uuid" } },
        { in: "query", name: "actorMemberId", schema: { type: "string", format: "uuid" } },
        { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
      ],
      responses: {
        "200": { description: "Paginated audit-event list" },
        "403": { description: "Requires admin / editor / moderator role" },
      },
    },
  };
  paths["/api/admin/sites"] = {
    get: {
      summary: "List registered sites (super-admin only)",
      responses: {
        "200": {
          description: "Exact registered site records",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["docs"],
                properties: {
                  docs: {
                    type: "array",
                    items: { $ref: "#/components/schemas/site_record" },
                  },
                },
              },
            },
          },
        },
        "403": { description: "Super-admin required" },
      },
    },
    post: {
      summary: "Create a registered site (super-admin only)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/site_create_input" },
          },
        },
      },
      responses: {
        "200": {
          description: "Created site",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/site_record" } },
          },
        },
        "400": { description: "Exact input contract violation" },
        "403": { description: "Super-admin required" },
      },
    },
  };
  paths["/api/admin/sites/accessible"] = {
    get: {
      summary: "List sites accessible to the current staff user",
      description:
        "Super-admins receive every registered site. Other staff receive explicit membership sites plus the reserved default site through its persisted global-role fallback. Global authentication keeps this recovery endpoint available when the saved active-site membership was revoked.",
      responses: {
        "200": {
          description: "Exact site-picker contract",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["docs", "isSuperAdmin", "currentId"],
                properties: {
                  docs: {
                    type: "array",
                    items: { $ref: "#/components/schemas/site_summary" },
                  },
                  isSuperAdmin: { type: "boolean" },
                  currentId: { type: "string", pattern: npSiteIdPattern },
                },
              },
            },
          },
        },
      },
    },
  };
  paths["/api/admin/sites/active"] = {
    post: {
      summary: "Select the active Admin site context",
      description:
        "Authenticates globally, then requires site.access on the requested target so a stale inaccessible active-site cookie cannot lock out site switching.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["id"],
              properties: { id: { type: "string", pattern: npSiteIdPattern } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Active site selected and HttpOnly cookie set",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["id"],
                properties: { id: { type: "string", pattern: npSiteIdPattern } },
              },
            },
          },
        },
        "400": { description: "Unknown site or exact input contract violation" },
        "403": { description: "Missing site.access capability on this site" },
      },
    },
    delete: {
      summary: "Clear the active Admin site override",
      description:
        "Uses global authentication so a stale inaccessible active-site cookie can always be cleared.",
      responses: { "200": { description: "Active-site cookie cleared" } },
    },
  };
  paths["/api/admin/sites/{id}"] = {
    parameters: [
      {
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string", pattern: npSiteIdPattern },
      },
    ],
    get: {
      summary: "Read a site using site-scoped admin authorization",
      responses: {
        "200": {
          description: "Site record",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/site_record" } },
          },
        },
        "403": { description: "Missing admin.manage capability on this site" },
      },
    },
    patch: {
      summary: "Update a site using site-scoped admin authorization",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/site_update_input" },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated site",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/site_record" } },
          },
        },
        "400": { description: "Exact input contract violation" },
        "403": { description: "Missing admin.manage capability on this site" },
      },
    },
    delete: {
      summary: "Delete a non-default site (super-admin only)",
      description:
        "Deletion is atomic. Attached rows block deletion unless cascade=true; cascade failure rolls back the whole operation.",
      parameters: [{ in: "query", name: "cascade", schema: { type: "boolean", default: false } }],
      responses: {
        "200": { description: "Site deleted" },
        "400": { description: "Default site or attached rows without cascade" },
        "403": { description: "Super-admin required" },
      },
    },
  };
  paths["/api/admin/sites/{id}/usage"] = {
    get: {
      summary: "Read exact site deletion usage",
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", pattern: npSiteIdPattern },
        },
      ],
      responses: {
        "200": {
          description: "Site identity and exact attached-row counts",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["site", "usage"],
                properties: {
                  site: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "name"],
                    properties: {
                      id: { type: "string", pattern: npSiteIdPattern },
                      name: { type: "string" },
                    },
                  },
                  usage: { $ref: "#/components/schemas/site_usage" },
                },
              },
            },
          },
        },
        "403": { description: "Missing admin.manage capability on this site" },
      },
    },
  };
  paths["/api/admin/sites/{id}/memberships"] = {
    parameters: [
      {
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string", pattern: npSiteIdPattern },
      },
    ],
    get: {
      summary: "List exact site membership records",
      responses: {
        "200": {
          description: "Site memberships",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["docs"],
                properties: {
                  docs: {
                    type: "array",
                    items: { $ref: "#/components/schemas/site_membership" },
                  },
                },
              },
            },
          },
        },
        "403": { description: "Missing admin.manage capability on this site" },
      },
    },
    post: {
      summary: "Grant or replace a site membership role",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/site_membership_grant_input" },
          },
        },
      },
      responses: {
        "200": {
          description: "Membership record",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/site_membership" },
            },
          },
        },
        "400": { description: "Unknown user/site or exact input contract violation" },
        "403": { description: "Missing admin.manage capability on this site" },
      },
    },
  };
  paths["/api/admin/sites/{id}/memberships/{userId}"] = {
    parameters: [
      {
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string", pattern: npSiteIdPattern },
      },
      {
        in: "path",
        name: "userId",
        required: true,
        schema: { type: "string", pattern: npUserIdPattern, format: "uuid" },
      },
    ],
    delete: {
      summary: "Revoke a site membership",
      responses: {
        "200": { description: "Membership revoked or already absent" },
        "400": { description: "Unknown site or invalid canonical user id" },
        "403": { description: "Missing admin.manage capability on this site" },
      },
    },
  };

  // Plugin-provided routes. These are resolved from the in-process registry,
  // so the spec only lists plugins that actually loaded (enabled + no errors).
  for (const route of getPluginRoutes()) {
    const fullPath = `/api/plugins/${encodeURIComponent(route.pluginId)}${route.path}`;
    const method = route.method.toLowerCase();
    const existing = (paths[fullPath] as Record<string, unknown> | undefined) ?? {};
    const operation = {
      summary: `Plugin route: ${route.method} ${route.path}`,
      tags: [`plugin:${route.pluginId}`],
      description: route.description ?? `Exposed by plugin \`${route.pluginId}\`.`,
      responses: {
        "200": { description: "Plugin response (shape depends on the plugin)" },
        "404": { description: "Plugin or route not found" },
      },
    };

    paths[fullPath] = {
      ...existing,
      [method]: operation,
      ...(route.method === "GET"
        ? { head: { ...operation, summary: `Plugin route: HEAD ${route.path}` } }
        : {}),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "NexPress API",
      version: "0.1.0",
      description:
        "Auto-generated from registered collections, media, settings, navigation, plugins, and the core auth / discovery routes. Internal endpoints under `/api/internal/*` are intentionally omitted.",
    },
    servers: [{ url: process.env.SITE_URL ?? "http://localhost:3000" }],
    components: {
      schemas,
      responses: npApiErrorOpenApiResponses,
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "np-session" },
        csrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
        memberSessionCookie: { type: "apiKey", in: "cookie", name: "np-mb-session" },
        memberCsrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
      },
    },
    security: [{ sessionCookie: [], csrfHeader: [] }],
    paths: npApplyApiErrorOpenApiResponses(paths),
  };
}

export async function GET() {
  await ensureFor("plugins");

  return NextResponse.json(buildSpec(), {
    headers: { "Cache-Control": "no-store" },
  });
}

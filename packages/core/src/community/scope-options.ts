import { findDocuments } from "../collections/pipeline.js";
import { getAllCollectionSlugs, getCollectionConfig } from "../collections/registry.js";
import { npRequireCommunityScopeCatalogWire } from "../community-contract/contract.js";
import type { NpCommunityScopeOptionWire } from "../community-contract/types.js";
import type { NpAuthUser, NpCollectionConfig, NpFieldConfig } from "../config/types.js";

import { npIsMemberModeratableDocument } from "./target-scopes.js";

const MAX_OPTIONS = 200;

function topLevelField(config: NpCollectionConfig, name: string): NpFieldConfig | undefined {
  const visit = (fields: NpFieldConfig[]): NpFieldConfig | undefined => {
    for (const field of fields) {
      if (field.type === "row" || field.type === "collapsible") {
        const nested = visit(field.fields);
        if (nested) return nested;
      } else if (field.name === name) {
        return field;
      }
    }
    return undefined;
  };
  return visit(config.fields);
}

function titleField(config: NpCollectionConfig): string | null {
  const visit = (fields: NpFieldConfig[]): string | null => {
    for (const field of fields) {
      if (field.type === "row" || field.type === "collapsible") {
        const nested = visit(field.fields);
        if (nested) return nested;
      } else if (field.admin?.kind === "title") {
        return field.name;
      }
    }
    return null;
  };
  return visit(config.fields);
}

function optionLabel(document: Record<string, unknown>, config: NpCollectionConfig): string {
  const title = titleField(config);
  const candidate = title && typeof document[title] === "string" ? document[title].trim() : "";
  const fallback =
    typeof document.slug === "string" && document.slug.trim()
      ? document.slug.trim()
      : String(document.id);
  const label = candidate || fallback;
  return label.length <= 120 ? label : `${label.slice(0, 119)}…`;
}

/**
 * Discover the bounded, current-site scope ids that can be assigned through
 * Admin. Categories come from declared relationship projections, threads from
 * moderation-enabled documents, and collections from comment/report-enabled slugs.
 */
export async function listCommunityScopeOptions(
  user?: NpAuthUser,
): Promise<NpCommunityScopeOptionWire[]> {
  const options: NpCommunityScopeOptionWire[] = [];
  const seen = new Set<string>();
  const add = (option: NpCommunityScopeOptionWire): void => {
    const key = `${option.scopeType}:${option.scopeId}`;
    if (seen.has(key) || options.length >= MAX_OPTIONS) return;
    seen.add(key);
    options.push(option);
  };
  const slugs = getAllCollectionSlugs().sort();

  for (const slug of slugs) {
    const config = getCollectionConfig(slug);
    if (config.community?.comments === true || config.community?.reports === true) {
      const label = config.labels.plural.trim();
      add({
        scopeType: "collection",
        scopeId: slug,
        label: label.length <= 120 ? label : `${label.slice(0, 119)}…`,
        sourceCollection: slug,
      });
    }
  }

  const categoryCollections = new Set<string>();
  for (const slug of slugs) {
    const config = getCollectionConfig(slug);
    const categoryField = config.community?.moderation?.categoryField;
    if (!categoryField) continue;
    const field = topLevelField(config, categoryField);
    if (
      field?.type === "relationship" &&
      field.hasMany !== true &&
      typeof field.relationTo === "string"
    ) {
      categoryCollections.add(field.relationTo);
    }
  }
  for (const slug of [...categoryCollections].sort()) {
    if (options.length >= MAX_OPTIONS) break;
    const config = getCollectionConfig(slug);
    const result = await findDocuments<Record<string, unknown>>(
      slug,
      {
        ...(config.versions?.drafts ? { where: { status: "published" } } : {}),
        page: 1,
        limit: Math.min(MAX_OPTIONS - options.length, 200),
      },
      user,
    );
    for (const document of result.docs) {
      if (typeof document.id !== "string") continue;
      add({
        scopeType: "category",
        scopeId: document.id,
        label: optionLabel(document, config),
        sourceCollection: slug,
      });
    }
  }

  for (const slug of slugs) {
    if (options.length >= MAX_OPTIONS) break;
    const config = getCollectionConfig(slug);
    if (!config.community?.moderation) continue;
    const result = await findDocuments<Record<string, unknown>>(
      slug,
      {
        ...(config.timestamps === false ? {} : { sort: "-updatedAt" }),
        page: 1,
        limit: Math.min(MAX_OPTIONS - options.length, 200),
      },
      user,
    );
    for (const document of result.docs) {
      if (typeof document.id !== "string") continue;
      if (!npIsMemberModeratableDocument(config, document)) continue;
      add({
        scopeType: "thread",
        scopeId: document.id,
        label: optionLabel(document, config),
        sourceCollection: slug,
      });
    }
  }

  return npRequireCommunityScopeCatalogWire({ docs: options }).docs;
}

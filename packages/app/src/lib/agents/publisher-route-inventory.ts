import {
  findDocuments,
  getCollectionConfig,
  getDb,
  npAssertCollectionReadAccess,
  type NpTransaction,
} from "@nexpress/core/collections";
import { npPublicCommunityAudienceWhere } from "@nexpress/core/community";
import { npRequireSeoPath, npRequireSitemapEntries, type NpSitemapEntry } from "@nexpress/core/seo";
import type {
  NpAgentPublisherRouteInventoryV1,
  NpAgentRuntimeRunContextV1,
} from "@nexpress/core/agents";
import { getActiveThemeId, listEnabledPluginIds, type NpFieldConfig } from "@nexpress/core";
import { withCurrentSite } from "@nexpress/core/sites";
import { getRegisteredBlocksForActiveSources, type NpBlockPropField } from "@nexpress/blocks";

/** Actual active-site block declarations for the read owner's resolveBlockFields seam. */
export function npCreateAgentPublisherAppBlockFieldsV1(options: {
  authorize: (siteId: string) => Promise<void>;
}): (
  siteId: string,
  transaction?: NpTransaction,
) => Promise<readonly { type: string; fields: NpFieldConfig[] }[]> {
  return async (siteId, transaction) => {
    await options.authorize(siteId);
    const [themeId, pluginIds] = await Promise.all([
      withCurrentSite(siteId, () => getActiveThemeId({ tx: transaction })),
      listEnabledPluginIds((transaction ?? getDb()) as ReturnType<typeof getDb>, siteId),
    ]);
    const fields = (entries: readonly NpBlockPropField[]): NpFieldConfig[] =>
      entries.map((field): NpFieldConfig => {
        // Conditional UI-only fields have no unconditional agent read guarantee.
        const common = {
          name: field.name,
          hidden: !!(field.hiddenWhen?.length || field.visibleWhen?.length),
        };
        switch (field.type) {
          case "array":
            return { ...common, type: "array", fields: fields(field.itemSchema) };
          case "boolean":
            return { ...common, type: "checkbox" };
          case "richtext":
            return { ...common, type: "richText" };
          case "number":
            return { ...common, type: "number" };
          case "select":
            return {
              ...common,
              type: "select",
              options: field.options.map((entry) => ({ ...entry })),
            };
          case "textarea":
            return { ...common, type: "textarea" };
          default:
            return { ...common, type: "text" };
        }
      });
    const result = getRegisteredBlocksForActiveSources({
      themeId,
      pluginIds: new Set(pluginIds),
    }).map((block) => ({ type: block.type, fields: fields(block.propsSchema) }));
    await options.authorize(siteId);
    return result;
  };
}

export interface NpAgentPublisherAppRouteInventoryOptionsV1 {
  /** Current site/caller authorization is checked on every observation. */
  authorize: (context: NpAgentRuntimeRunContextV1) => Promise<void>;
  /** Public routing collections whose canonical SEO urlPath is the route owner. */
  collectionSlugs: readonly string[];
  /** Already enumerated public static/theme/plugin routes; never URL patterns or network reads. */
  fixedRoutes: readonly NpSitemapEntry[];
  /**
   * Explicit host declaration that these sources cover its entire public route surface.
   * Leave false when custom/dynamic/plugin routes have not been fully enumerated.
   * A failed, changed, unsupported or truncated source still forces partial coverage.
   */
  publicSurfaceComplete: boolean;
  /** Shared row budget across collections, independent of route de-duplication. */
  documentLimit?: number;
}

/**
 * Concrete bounded supplier for the framework read owner's publisherRouteInventory facet.
 * Reuses anonymous collection ACLs and canonical SEO urlPath declarations. Installing
 * this factory does not install a recipe, resolve credentials or activate any Runtime.
 */
export function npCreateAgentPublisherAppRouteInventoryV1(
  options: NpAgentPublisherAppRouteInventoryOptionsV1,
): (context: NpAgentRuntimeRunContextV1) => Promise<NpAgentPublisherRouteInventoryV1> {
  const documentLimit = options.documentLimit ?? 2000;
  if (
    !Number.isSafeInteger(documentLimit) ||
    documentLimit < 1 ||
    documentLimit > 2000 ||
    options.collectionSlugs.length > 50 ||
    new Set(options.collectionSlugs).size !== options.collectionSlugs.length ||
    options.collectionSlugs.some((slug) => !/^[a-z][a-z0-9-]{0,127}$/u.test(slug)) ||
    typeof options.publicSurfaceComplete !== "boolean"
  )
    throw new Error("Invalid Publisher public route sources.");
  const collectionSlugs = [...options.collectionSlugs].sort();
  const { authorize, publicSurfaceComplete } = options;
  const fixedRoutes = npRequireSitemapEntries(options.fixedRoutes).map((entry) => ({
    path: exactRoute(entry.loc),
    updatedAt: entry.lastmod ?? null,
  }));
  if (fixedRoutes.length > 2000) throw new Error("Publisher route inventory exceeds its bound.");
  return async (context) => {
    await authorize(context);
    let complete = publicSurfaceComplete;
    let remaining = documentLimit;
    const routes = new Map<string, { path: string; updatedAt: string | null }>(
      fixedRoutes.map((route) => [route.path, { ...route }]),
    );
    for (const collection of collectionSlugs) {
      if (remaining === 0 || routes.size === 2000) {
        complete = false;
        break;
      }
      try {
        const config = getCollectionConfig(collection);
        const urlPath = config.seo?.urlPath;
        if (!urlPath) {
          complete = false;
          continue;
        }
        const result = await findDocuments<Record<string, unknown>>(
          collection,
          {
            limit: remaining,
            page: 1,
            sort: "id",
            where: {
              siteId: context.siteId,
              status: "published",
              visibility: "public",
              ...npPublicCommunityAudienceWhere(config),
            },
          },
          undefined,
          { tx: context.db as unknown as NpTransaction },
        );
        remaining -= result.docs.length;
        // Do not publish totalDocs or identities for any excluded source.
        if (result.hasNextPage || result.totalDocs !== result.docs.length) complete = false;
        for (const document of result.docs) {
          if (
            document.siteId !== context.siteId ||
            document.status !== "published" ||
            document.visibility !== "public" ||
            (config.community?.audience === true && document.audience !== "public")
          ) {
            complete = false;
            continue;
          }
          try {
            await npAssertCollectionReadAccess(config, collection, null, document);
            const location = urlPath(document);
            if (location === null) continue; // Explicitly has no public canonical route.
            const path = exactRoute(location);
            const updatedAt = timestamp(document.updatedAt);
            const previous = routes.get(path);
            if (previous) {
              // Colliding route owners establish existence, but not which source's age wins.
              if (previous.updatedAt !== updatedAt) previous.updatedAt = null;
              continue;
            }
            if (routes.size === 2000) {
              complete = false;
              break;
            }
            routes.set(path, { path, updatedAt });
          } catch {
            complete = false;
          }
        }
      } catch {
        // ACL/read/config failures all have the same non-diagnostic partial projection.
        complete = false;
      }
    }
    // Recheck current site/caller after all reads and before returning public facts.
    await authorize(context);
    return {
      siteId: context.siteId,
      complete,
      routes: [...routes.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
  };
}

function exactRoute(value: string): string {
  const path = npRequireSeoPath(value);
  if (
    path.length > 2048 ||
    /[?#\\\s]/u.test(path) ||
    new URL(path, "https://publisher.invalid").pathname !== path
  )
    throw new Error("Publisher requires an exact canonical public route.");
  return path;
}

function timestamp(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

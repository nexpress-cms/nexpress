import { and, eq } from "drizzle-orm";
import {
  getActiveThemeId,
  getCurrentSiteId,
  getThemeById,
  getSetting,
  setNavigation,
  setTheme,
  NP_DEFAULT_SITE_ID,
  npNavigation,
  setActiveThemeId,
  NpConflictError,
  NpForbiddenError,
  NpValidationError,
  type NpAuthUser,
  type NpCollectionConfig,
  type NpFieldConfig,
  type NpTransaction,
} from "@nexpress/core";
import { can } from "@nexpress/core/auth";
import {
  getCollectionConfig,
  getCollectionZodSchema,
  getDocumentById,
  saveDocument,
} from "@nexpress/core/collections";
import { getDb } from "@nexpress/core/db";
import { getI18nConfig } from "@nexpress/core/i18n";
import {
  npInvalidateCache,
  type NpCacheInvalidationRequest,
  type NpCacheInvalidationResult,
} from "@nexpress/core/cache";
import {
  DEFAULT_THEME,
  isNpThemeTokensOverlay,
  npMergeThemeTokens,
  type NpThemeTokensOverlay,
} from "@nexpress/core/theme";
import {
  npIsCanonicalCollectionDocumentSlug,
  npRequireCollectionJsonValue,
} from "@nexpress/core/collection-contract";
import {
  npRequireAgentSiteBlueprintV1,
  npRequireAgentBuildSeedPlanV1,
  npRequireAgentBuildNavigationV1,
  type NpAgentBlueprintSeedPlan,
  type NpAgentBlueprintNavigation,
} from "@nexpress/core/agent-contract";
import {
  getRegisteredBlockMetadataForActiveSources,
  npAnalyzeBlockContent,
} from "@nexpress/blocks";
import { createSiteScopedBlockRenderContext, navCacheTag, themeCacheTag } from "@nexpress/next";
import type { NpTheme } from "@nexpress/theme";
import type { NpSiteBuildOwnerBindingV1 } from "./site-build-catalog.js";
import type { NpConfiguredBuildRenderFixtureV1 } from "./site-build-render-fixture.js";

export interface NpSiteBuildSeedArtifactV1 {
  schemaVersion: "np.site-build-seed.v1";
  theme: { id: string; package: string; tokens: NpThemeTokensOverlay };
  seed: NpAgentBlueprintSeedPlan;
  navigation: NpAgentBlueprintNavigation[];
}
const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const invalid = (message: string): never => {
  throw new NpValidationError("Invalid site build seed", [{ field: "seed", message }]);
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid("Expected a JSON object.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    invalid("Unexpected seed artifact fields.");
}
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? invalid("Undefined values are unsupported.");
}

/** Ordinary data only. No blueprint hash/file plan, filesystem, bootstrap or execution authority. */
export function npRequireSiteBuildSeedArtifactV1(value: unknown): NpSiteBuildSeedArtifactV1 {
  const body = record(npRequireCollectionJsonValue(value, "seedArtifact"));
  if (Buffer.byteLength(JSON.stringify(body)) > 4 * 1024 * 1024)
    invalid("Seed artifact exceeds the bounded JSON profile.");
  keys(body, ["schemaVersion", "theme", "seed", "navigation"]);
  if (body.schemaVersion !== "np.site-build-seed.v1") invalid("Unsupported seed artifact version.");
  const theme = record(body.theme);
  keys(theme, ["id", "package", "tokens"]);
  if (
    typeof theme.id !== "string" ||
    theme.id.length > 128 ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(theme.id) ||
    typeof theme.package !== "string" ||
    theme.package.length > 200 ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(theme.package) ||
    !isNpThemeTokensOverlay(theme.tokens)
  )
    return invalid("Theme identity or tokens are invalid.");
  const navigationValue = body.navigation;
  if (!Array.isArray(navigationValue) || navigationValue.length > 32)
    return invalid("Navigation is outside its bounded profile.");
  const navigation = navigationValue.map(npRequireAgentBuildNavigationV1);
  if (
    navigation.some(
      (item, index) => index > 0 && compare(navigation[index - 1].location, item.location) >= 0,
    )
  )
    invalid("Navigation locations must be unique and in UTF-8 order.");
  return {
    schemaVersion: "np.site-build-seed.v1",
    theme: { id: theme.id, package: theme.package, tokens: theme.tokens },
    seed: npRequireAgentBuildSeedPlanV1(body.seed),
    navigation,
  };
}

export function npCreateSiteBuildSeedArtifactV1(
  blueprintValue: unknown,
  themeBinding: { id: string; package: string },
): NpSiteBuildSeedArtifactV1 {
  const blueprint = npRequireAgentSiteBlueprintV1(blueprintValue);
  if (blueprint.theme.package !== themeBinding.package)
    invalid("Theme binding must match the blueprint package.");
  return npRequireSiteBuildSeedArtifactV1({
    schemaVersion: "np.site-build-seed.v1",
    theme: { ...themeBinding, tokens: blueprint.theme.tokens },
    seed: blueprint.seed,
    navigation: [...blueprint.navigation].sort((a, b) => compare(a.location, b.location)),
  });
}
export function npSerializeSiteBuildSeedArtifactV1(value: unknown): string {
  const artifact = npRequireSiteBuildSeedArtifactV1(value);
  const output = `${JSON.stringify(JSON.parse(canonical(artifact)) as unknown, null, 2)}\n`;
  if (Buffer.byteLength(output) > 4 * 1024 * 1024)
    invalid("Formatted seed artifact exceeds its byte limit.");
  return output;
}
/** The host supplies the actual selected projection; this is equality, never rendering proof. */
export function npReconcileSiteBuildSeedArtifactV1(
  value: unknown,
  fixtureValue: NpConfiguredBuildRenderFixtureV1,
): void {
  const artifact = npRequireSiteBuildSeedArtifactV1(value),
    fixture = record(npRequireCollectionJsonValue(fixtureValue));
  if (
    fixture.schemaVersion !== "np.configured-build-render-fixture.v1" ||
    canonical(artifact.theme) !== canonical(fixture.theme) ||
    canonical(artifact.seed.documents) !== canonical(fixture.documents) ||
    canonical(artifact.navigation) !== canonical(fixture.navigation)
  )
    throw new NpConflictError(
      "Seed artifact must exactly match selected rendered theme, documents and navigation.",
    );
}

type Document = NpAgentBlueprintSeedPlan["documents"][number];
function noDefaults(before: unknown, after: unknown): void {
  if (Array.isArray(after) && Array.isArray(before)) {
    after.forEach((value, index) => noDefaults(before[index], value));
    return;
  }
  if (after && typeof after === "object" && !(after instanceof Date)) {
    const original = record(before),
      parsed = after as Record<string, unknown>;
    if (Object.keys(original).some((key) => !Object.hasOwn(parsed, key)))
      invalid("Seed data contains an unknown field.");
    for (const [key, value] of Object.entries(parsed)) {
      if (!Object.hasOwn(original, key) && value !== undefined)
        invalid("Seed data must explicitly supply defaulted fields.");
      if (Object.hasOwn(original, key)) noDefaults(original[key], value);
    }
  }
}
function topNames(fields: readonly NpFieldConfig[]): string[] {
  return fields.flatMap((field) =>
    field.type === "row" || field.type === "collapsible" ? topNames(field.fields) : [field.name],
  );
}
function matchesDocument(
  existing: Record<string, unknown>,
  document: Document,
  config: NpCollectionConfig,
  status: "draft" | "published",
): boolean {
  // Compare the owning static field normalization (notably Date coercion),
  // while leaving all custom validators/hooks to the normal pipeline.
  const parsed = getCollectionZodSchema(config).safeParse(document.data);
  if (!parsed.success) return false;
  const expectedData = record(parsed.data);
  if (
    existing.id !== document.documentId ||
    existing.status !== status ||
    (existing.locale ?? null) !== document.locale ||
    (existing.translationGroupId ?? null) !== document.translationGroupId ||
    (existing.visibility ?? "public") !== (document.data.visibility ?? "public")
  )
    return false;
  for (const key of new Set([
    ...topNames(config.fields),
    ...Object.keys(document.data),
    ...(config.slugField ? ["slug"] : []),
  ])) {
    const wanted = expectedData[key],
      actual = existing[key];
    if (wanted === undefined && (actual === undefined || actual === null)) continue;
    if (wanted === undefined || actual === undefined || canonical(wanted) !== canonical(actual))
      return false;
  }
  return true;
}

export interface NpSiteBuildSeedMaterializationV1 {
  scope: "ordinary-site-build-seed";
  documents: { created: string[]; unchanged: string[] };
  theme: "written" | "unchanged";
  navigation: { created: string[]; unchanged: string[] };
  media: {
    staged: "unsupported-allocated-id-owner-required";
    referenceOnlyRetained: string[];
    fetched: 0;
    uploaded: 0;
  };
  transaction: "caller-owned" | "individual-facade-commits";
  pendingCacheInvalidations: NpCacheInvalidationRequest[];
  cacheInvalidations: NpCacheInvalidationResult[];
}

/**
 * Caller must already ensureFor('write'), select the existing site and supply a
 * real authenticated staff actor plus actual host owner bindings. No bootstrap,
 * pool, principal, storage, provider, worker or credential is created here.
 * A caller tx must be enclosed by withDeferredPostCommit around its outer commit;
 * dispatch returned cache intents only after that commit. Without tx, failures can
 * leave earlier normal facade writes committed. Existence checks are not atomic
 * absent-row CAS; run seeds exclusively. Different existing content is preserved.
 * Media uploadMedia currently mints random IDs and has no caller tx/createId seam;
 * staged media therefore fails before any write. Reference metadata stays solely
 * in the ordinary artifact and is never fetched or uploaded by this owner.
 */
export async function npMaterializeSiteBuildSeedV1(
  value: unknown,
  user: NpAuthUser,
  options: {
    ownerBindings: readonly NpSiteBuildOwnerBindingV1[];
    status: "draft" | "published";
    tx?: NpTransaction;
  },
): Promise<NpSiteBuildSeedMaterializationV1> {
  const artifact = npRequireSiteBuildSeedArtifactV1(value);
  if (!can(user, "admin.manage")) throw new NpForbiddenError("site-build-seed", "write");
  if (!["draft", "published"].includes(options.status))
    invalid("The host must choose an explicit document status.");
  if (artifact.seed.media.some((media) => media.materialization === "staged"))
    invalid(
      "Staged media requires an existing allocated-id upload/provenance owner; uploadMedia cannot preserve these IDs.",
    );
  const theme = getThemeById(artifact.theme.id);
  const themeOwners = options.ownerBindings.filter((binding) => binding.value === theme);
  if (!theme || themeOwners.length !== 1 || themeOwners[0].package !== artifact.theme.package)
    invalid("Theme package must have exactly one actual registered host owner identity.");
  const implementation = (theme as NpTheme).impl;
  if (implementation.tokens !== undefined && !isNpThemeTokensOverlay(implementation.tokens))
    invalid("Registered theme tokens are malformed.");
  const locations = new Set([
    "header",
    "footer",
    "main",
    ...Object.keys(implementation.navLocations ?? {}),
  ]);
  const documents = new Map(
    artifact.seed.documents.map((document) => [document.documentId, document]),
  );
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const context = await createSiteScopedBlockRenderContext();
  if (!context.activeSources) return invalid("Actual site plugin-source context is required.");
  const definitions = getRegisteredBlockMetadataForActiveSources({
    themeId: artifact.theme.id,
    pluginIds: context.activeSources.pluginIds,
  });
  const collections = new Map<string, NpCollectionConfig>();
  const existingDocuments = new Map<string, Record<string, unknown> | null>();
  const translations = new Set<string>();
  for (const document of artifact.seed.documents) {
    const config = getCollectionConfig(document.collection);
    collections.set(config.slug, config);
    for (const key of [
      "id",
      "documentId",
      "collection",
      "siteId",
      "createdBy",
      "updatedBy",
      "createdAt",
      "updatedAt",
      "status",
      "locale",
      "translationGroupId",
      "translation_group_id",
    ])
      if (Object.hasOwn(document.data, key))
        invalid("Seed data cannot override framework metadata.");
    if (
      config.i18n
        ? document.locale === null ||
          document.translationGroupId === null ||
          !getI18nConfig()?.locales.includes(document.locale)
        : document.locale !== null || document.translationGroupId !== null
    )
      invalid("Seed locale metadata must match the actual collection.");
    if (document.translationGroupId !== null) {
      const key = `${document.collection}:${document.translationGroupId}:${document.locale}`;
      if (translations.has(key)) invalid("A translation group cannot repeat a locale.");
      translations.add(key);
    }
    const parsed = getCollectionZodSchema(config).safeParse(document.data);
    if (!parsed.success) invalid("Seed data must satisfy its actual static collection schema.");
    noDefaults(document.data, parsed.data);
    if (config.slugField && !npIsCanonicalCollectionDocumentSlug(document.data.slug))
      invalid("Seed slugs must be explicit and canonical.");
    const references = new Set<string>();
    const walk = (fields: readonly NpFieldConfig[], data: Record<string, unknown>) => {
      for (const field of fields) {
        if (field.type === "row" || field.type === "collapsible") {
          walk(field.fields, data);
          continue;
        }
        const entry = data[field.name];
        if (entry === undefined || entry === null) continue;
        if (field.type === "group") walk(field.fields, record(entry));
        if (field.type === "array")
          for (const row of entry as unknown[]) walk(field.fields, record(row));
        if (field.type === "blocks" && npAnalyzeBlockContent(entry, definitions).length)
          invalid("Seed blocks must match actual selected-theme and active-plugin definitions.");
        if (field.type === "upload")
          invalid("Media fields require the unavailable allocated-id media owner.");
        if (field.type === "relationship")
          for (const id of field.hasMany ? (entry as string[]) : [entry as string]) {
            const target = documents.get(id);
            if (
              !target ||
              !(Array.isArray(field.relationTo)
                ? field.relationTo.includes(target.collection)
                : field.relationTo === target.collection)
            )
              invalid("Relationships require allocated matching seed documents.");
            references.add(id);
          }
      }
    };
    walk(config.fields, document.data);
    if (canonical([...references].sort(compare)) !== canonical(document.dependsOnDocumentIds))
      invalid("Dependencies must exactly match actual relationship fields.");
    const existing = await getDocumentById(document.collection, document.documentId, user, {
      tx: options.tx,
    });
    if (existing && !matchesDocument(existing, document, config, options.status))
      throw new NpConflictError(
        "Existing allocated seed document differs; preserve it and reconcile explicitly.",
      );
    existingDocuments.set(document.documentId, existing);
  }
  const walkNavigation = (items: NpAgentBlueprintNavigation["items"]) => {
    for (const item of items) {
      if (item.type === "collection") getCollectionConfig(item.collection);
      if (
        item.type === "page" &&
        documents.get(item.pageId)?.collection !== (item.collectionSlug ?? "pages")
      )
        invalid("Navigation pages must reference matching allocated seed documents.");
      if (item.children) walkNavigation(item.children);
    }
  };
  const db = options.tx ?? getDb(),
    pendingNavigation: string[] = [],
    unchangedNavigation: string[] = [];
  for (const navigation of artifact.navigation) {
    if (!locations.has(navigation.location))
      invalid("Navigation location must belong to the actual selected theme.");
    walkNavigation(navigation.items);
    const rows = await db
      .select({ items: npNavigation.items })
      .from(npNavigation)
      .where(and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, navigation.location))!)
      .limit(1);
    if (rows.length) {
      const existing = npRequireAgentBuildNavigationV1({
        location: navigation.location,
        items: record(rows[0]).items,
      });
      if (canonical(existing.items) !== canonical(navigation.items))
        throw new NpConflictError(
          "Existing seed navigation differs; preserve it and reconcile explicitly.",
        );
      unchangedNavigation.push(navigation.location);
    } else pendingNavigation.push(navigation.location);
  }
  const currentTheme = await getActiveThemeId({ tx: options.tx });
  if (currentTheme !== null && currentTheme !== artifact.theme.id)
    throw new NpConflictError("An existing active theme differs from the seed artifact.");
  const tokens = npMergeThemeTokens(DEFAULT_THEME, implementation.tokens, artifact.theme.tokens);
  const storedTokens = await getSetting("theme", { tx: options.tx });
  if (
    storedTokens !== null &&
    (!isNpThemeTokensOverlay(storedTokens) ||
      canonical(npMergeThemeTokens(DEFAULT_THEME, implementation.tokens, storedTokens)) !==
        canonical(tokens))
  )
    throw new NpConflictError("Existing theme tokens differ from the seed artifact.");
  const themeChanged = currentTheme === null || storedTokens === null;
  const invalidations: NpCacheInvalidationRequest[] = [];
  const cacheInvalidations: NpCacheInvalidationResult[] = [];
  const invalidate = async (request: NpCacheInvalidationRequest) => {
    invalidations.push(request);
    if (!options.tx) cacheInvalidations.push(await npInvalidateCache(request));
  };
  let themeWritten = false;
  try {
    if (currentTheme === null) {
      await setActiveThemeId(artifact.theme.id, user.id, { tx: options.tx });
      themeWritten = true;
    }
    if (storedTokens === null) {
      await setTheme(tokens, user, { tx: options.tx });
      themeWritten = true;
    }
  } finally {
    if (themeWritten)
      await invalidate({
        source: "theme",
        siteId,
        themeId: artifact.theme.id,
        tags: [themeCacheTag(siteId)],
      });
  }
  const created: string[] = [],
    unchanged: string[] = [];
  for (const document of artifact.seed.documents) {
    if (existingDocuments.get(document.documentId)) {
      unchanged.push(document.documentId);
      continue;
    }
    const data: Record<string, unknown> = { ...document.data };
    if (document.locale !== null) {
      data.locale = document.locale;
      data.translationGroupId = document.translationGroupId;
    }
    const saved = await saveDocument(document.collection, null, data, user, {
      createId: document.documentId,
      status: options.status,
      tx: options.tx,
    });
    if (
      !matchesDocument(saved.doc, document, collections.get(document.collection)!, options.status)
    )
      throw new NpConflictError(
        "Normal save hooks changed the exact seed projection; reconcile or roll back the caller transaction.",
      );
    created.push(document.documentId);
  }
  for (const navigation of artifact.navigation)
    if (pendingNavigation.includes(navigation.location)) {
      await setNavigation(navigation.location, navigation.items, user, { tx: options.tx });
      await invalidate({
        source: "navigation",
        siteId,
        navigationLocation: navigation.location,
        tags: [navCacheTag(siteId, navigation.location)],
      });
    }
  return {
    scope: "ordinary-site-build-seed",
    documents: { created, unchanged },
    theme: themeChanged ? "written" : "unchanged",
    navigation: { created: pendingNavigation, unchanged: unchangedNavigation },
    media: {
      staged: "unsupported-allocated-id-owner-required",
      referenceOnlyRetained: artifact.seed.media.map((media) => media.mediaId),
      fetched: 0,
      uploaded: 0,
    },
    transaction: options.tx ? "caller-owned" : "individual-facade-commits",
    pendingCacheInvalidations: options.tx ? invalidations : [],
    cacheInvalidations,
  };
}

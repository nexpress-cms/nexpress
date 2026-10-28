import {
  defineConfig,
  getCollectionZodSchema,
  type NpCollectionConfig,
  type NpConfig,
  type NpFieldConfig,
} from "@nexpress/core";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npProjectBuildCollectionDefinitionV1,
  npRequireBuildBlueprintForBriefV1,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import {
  npAnalyzeBlockContent,
  type NpBlockContent,
  type NpBlockPropField,
} from "@nexpress/blocks";
import { npIsCanonicalCollectionDocumentSlug } from "@nexpress/core/collection-contract";
import { buildDeployPlan } from "../scripts/deploy-plan-core.js";
import {
  npResolveConfiguredBuildCatalogV1,
  type NpSiteBuildOwnerBindingV1,
} from "./site-build-catalog.js";
import { npValidateConfiguredBuildDirectionSetV1 } from "./site-build-proposal.js";

const compare = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
function fail(message: string): never {
  throw new Error(`Invalid configured Build blueprint: ${message}`);
}
// Inputs here have already passed their owning detached JSON contracts.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? fail("unsupported declaration value");
}

/**
 * Loaded declarations only. The host owns isolated loading, source/staged-byte
 * observation, receipt/image authentication and fresh post-apply config loading.
 * This never proves that planned source exports a definition, that routes render,
 * that ACLs authorize a seed, or that any command, migration or provider ran.
 * Plugin discoveryFingerprint uses the existing complete installed-catalog owner;
 * v1 has no separate per-plugin Build fingerprint or environment-name inventory.
 */
export async function npValidateConfiguredBuildBlueprintV1(
  configValue: unknown,
  sourceCapsuleValue: unknown,
  defaultOwnerBindings: readonly NpSiteBuildOwnerBindingV1[],
  briefValue: unknown,
  sealedDirectionsValue: unknown,
  blueprintValue: unknown,
) {
  const blueprint = await npRequireBuildBlueprintForBriefV1(briefValue, blueprintValue);
  const { catalog, fingerprint, set } = await npValidateConfiguredBuildDirectionSetV1(
    configValue,
    sourceCapsuleValue,
    defaultOwnerBindings,
    briefValue,
    sealedDirectionsValue,
    "sealed",
  );
  const selected = set.directions.find(
    (direction) => direction.id === blueprint.selectedDirectionId,
  );
  if (
    !selected ||
    blueprint.directionSetHash !==
      (await npBuildCanonicalDigest("np.build-design-direction-set.v1", set)) ||
    blueprint.selectedDirectionHash !==
      (await npBuildCanonicalDigest("np.build-design-direction.v1", selected))
  )
    fail("selection must bind the exact complete sealed set and selected member");
  if (blueprint.discoveryFingerprint !== fingerprint)
    fail("blueprint must bind the fresh complete installed catalog");
  const architecture = set.comparisonInputs.informationArchitecture;
  if (
    architecture.length !== blueprint.pages.length ||
    blueprint.pages.some(
      (page) =>
        !architecture.some(
          (entry) =>
            entry.pageId === page.id &&
            entry.route === page.route &&
            entry.locale === page.locale &&
            entry.audience === page.audience,
        ),
    )
  )
    fail("pages must exactly project every comparison IA identity, route, locale and audience");
  const projection = npBuildDirectionProjectionV1(selected);
  const blueprintProjection = {
    ...projection,
    themeBase: blueprint.theme.package,
    tokens: blueprint.theme.tokens,
    pageBindings: blueprint.pages
      .map((page) => ({
        pageId: page.id,
        source: page.source,
        patternId: page.patternId,
        overrides: page.patternOverrides,
        templateId: page.templateId,
        blocks: page.blocks,
      }))
      .sort((left, right) => compare(left.pageId, right.pageId)),
  };
  const projectionDigest = await npBuildCanonicalDigest(
    "np.build-design-direction-projection.v1",
    blueprintProjection,
  );
  if (
    projectionDigest !== selected.projectionDigest ||
    projectionDigest !== blueprint.selectedDirectionProjectionDigest
  )
    fail(
      "theme, tokens and exact materialized page bindings must equal the selected direction projection",
    );
  const config = defineConfig(configValue as NpConfig);
  const resolved = await npResolveConfiguredBuildCatalogV1(
    configValue,
    sourceCapsuleValue,
    defaultOwnerBindings,
  );
  if (resolved.fingerprint !== fingerprint) fail("declarations changed during validation");
  const theme = catalog.themes.find((entry) => entry.package === blueprint.theme.package);
  const definitions = resolved.themes.find(
    (entry) => entry.package === blueprint.theme.package,
  )?.definitions;
  if (!theme || !definitions) fail("selected theme requires one installed owner");
  const framework = catalog.sourceCapsule.packages.filter((pkg) => pkg.name === "@nexpress/core");
  if (framework.length !== 1 || framework[0].version !== blueprint.framework.nexpressVersion)
    fail("framework version must match the exact installed Core instance");
  const sourceFiles = new Map(
    catalog.sourceCapsule.projectSources.files.map((file) => [file.path, file]),
  );
  const collections = new Map(
    config.collections.map((collection) => [collection.slug, collection]),
  );
  const definitionsBySlug = new Map(
    catalog.collections.map((definition) => [definition.configuration.slug, definition]),
  );
  for (const collection of blueprint.collections) {
    const current = definitionsBySlug.get(collection.slug);
    const source = sourceFiles.get(collection.sourcePath);
    if (
      collection.action === "create"
        ? source !== undefined
        : !source || source.digest !== collection.expectedSourceHash
    )
      fail("collection source precondition must match the observed source inventory");
    const identical =
      current !== undefined && canonical(current) === canonical(collection.definition);
    if (collection.action === "reuse") {
      if (!identical) fail("reused collection definition must equal the complete live definition");
      continue;
    }
    if (collection.action === "create" && current)
      fail("create collection slug is already configured; reload the plan as reuse/update");
    if (collection.action === "update" && !current)
      fail("updated collection must already be configured");
    const file = blueprint.filePlan.find((row) => row.path === collection.sourcePath);
    if (
      !file ||
      file.source !== "staged" ||
      file.owner !== "collection" ||
      file.action !== collection.action ||
      file.expectedHash !== collection.expectedSourceHash
    )
      fail("changed collections require an exact staged collection source file-plan row");
    if (!identical && (collection.definition.callbacks.length || current?.callbacks.length))
      fail(
        "changed callback collection requires the exact source-loaded definition; custom callback authoring is unsupported",
      );
    if (
      collection.action === "create" &&
      !blueprint.filePlan.some((row) => row.source === "staged" && row.owner === "config")
    )
      fail("new collections require a staged config registration owner");
    if (!identical)
      collections.set(
        collection.slug,
        collection.definition.configuration as unknown as NpCollectionConfig,
      );
  }
  // Reuse the complete project/collection analyzer for duplicate targets, fields,
  // i18n and relationship references. It validates functions without invoking them.
  const candidateConfig = defineConfig({ ...config, collections: [...collections.values()] });
  for (const plugin of blueprint.plugins) {
    const actual = catalog.plugins.find((entry) => entry.package === plugin.package);
    if (
      !actual ||
      actual.version !== plugin.version ||
      plugin.discoveryFingerprint !== fingerprint ||
      plugin.requiredCapabilities.some(
        (capability) => !actual.declaration.capabilities.includes(capability),
      )
    )
      fail(
        "plugin package, version, catalog fingerprint and capabilities must match installed declarations",
      );
    if (plugin.configPlaceholders.length)
      fail(
        "plugin environment placeholders have no shipped declaration inventory and are unsupported",
      );
  }
  const plan = buildDeployPlan(
    blueprint.deployment.target === "local" ? "docker" : blueprint.deployment.target,
  );
  const environmentNames = new Set(
    [...plan.requiredEnv, ...plan.recommendedEnv].map((entry) => entry.split("=")[0]),
  );
  for (const entry of blueprint.deployment.requiredEnvironment) {
    if (
      !environmentNames.has(entry.name) ||
      entry.sourceId !== null ||
      entry.owner === "plugin" ||
      entry.owner === "adapter" ||
      (entry.owner === "nexpress") !== entry.name.startsWith("NP_")
    )
      fail(
        "environment names require the closed shipped platform/NexPress inventory; custom owners are unsupported",
      );
  }
  const routes = new Set(blueprint.pages.map((page) => page.route));
  const publicAssets = new Set(
    [...sourceFiles.keys()]
      .filter((path) => path.startsWith("public/"))
      .map((path) => path.slice(6)),
  );
  const local = (value: string) => {
    if (!value.startsWith("/") || value.startsWith("//") || /[%\\?#]/u.test(value)) return false;
    const url = new URL(value, "http://build.invalid");
    return url.origin === "http://build.invalid" && url.pathname === value;
  };
  const link = (value: string) => {
    if (!value || value.startsWith("#")) return;
    if (local(value) && (routes.has(value) || publicAssets.has(value))) return;
    try {
      const url = new URL(value);
      if (["https:", "mailto:", "tel:"].includes(url.protocol) && !url.username && !url.password)
        return;
    } catch {
      /* Fall through to the owned boundary. */
    }
    fail(
      "local links require declared IA/asset targets; unresolved or custom route references are unsupported",
    );
  };
  const image = (value: string) => {
    if (value && (!local(value) || !publicAssets.has(value)))
      fail(
        "image props require observed local public assets; external/package/media URL owners are unsupported",
      );
  };
  const checkBlocks = (blocks: NpBlockContent) => {
    if (npAnalyzeBlockContent(blocks, definitions).length)
      fail("blocks must satisfy the selected actual definitions");
    const walkProps = (fields: readonly NpBlockPropField[], props: Record<string, unknown>) => {
      for (const field of fields) {
        const value = props[field.name] ?? field.defaultValue;
        if (value === undefined || value === null || value === "") continue;
        if (field.type === "collection" && (typeof value !== "string" || !collections.has(value)))
          fail("block collection props require configured collection targets");
        if (field.type === "image") image(value as string);
        if (field.type === "url") link(value as string);
        if (field.type === "array")
          for (const row of value as Record<string, unknown>[]) walkProps(field.itemSchema, row);
        if (field.type === "richtext") checkRichText(value);
      }
    };
    for (const block of blocks) {
      const definition = definitions.find((entry) => entry.type === block.type);
      if (!definition) fail("block owner disappeared");
      walkProps(definition.propsSchema, block.props);
      if (block.children) checkBlocks(block.children);
    }
  };
  const checkRichText = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(checkRichText);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "image" || node.type === "link")
      fail("rich-text image/link asset references require an explicit supported owner");
    Object.values(node).forEach(checkRichText);
  };
  for (const page of blueprint.pages) {
    if (page.source === "custom") {
      const template = theme.templates.find((entry) => entry.id === page.templateId);
      if (!template || !collections.has(template.collection))
        fail("page template must resolve to a configured collection owner");
    } else if (!collections.has("pages"))
      fail("pattern pages require the configured pages collection");
    checkBlocks(page.blocks);
  }
  validateSeed(blueprint, candidateConfig, checkBlocks, checkRichText);
  const documents = new Map(
    blueprint.seed.documents.map((document) => [document.documentId, document]),
  );
  const walkNavigation = (items: NpAgentSiteBlueprintV1["navigation"][number]["items"]): void => {
    for (const item of items) {
      if (item.type === "link") link(item.url);
      if (item.type === "collection" && !collections.has(item.collection))
        fail("navigation collection must be configured");
      if (
        item.type === "page" &&
        documents.get(item.pageId)?.collection !== (item.collectionSlug ?? "pages")
      )
        fail(
          "navigation page ids require allocated matching seed documents; external DB references are unsupported",
        );
      if (item.children) walkNavigation(item.children);
    }
  };
  for (const navigation of blueprint.navigation) {
    if (!theme.navigationLocations.includes(navigation.location))
      fail("navigation location must belong to the selected theme");
    walkNavigation(navigation.items);
  }
  const capsuleDigest = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    catalog.sourceCapsule,
  );
  return {
    scope: "declarations-only" as const,
    catalog,
    fingerprint,
    blueprint,
    blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
    // Expected declaration DTOs retain the baseline capsule binding. The host
    // must separately prove the exact planned source delta before comparing a
    // freshly loaded candidate whose callback capsule binding has changed.
    expectedCollectionDefinitions: candidateConfig.collections
      .map((collection) => npProjectBuildCollectionDefinitionV1(collection, capsuleDigest))
      .sort((left, right) =>
        compare(
          typeof left.configuration.slug === "string" ? left.configuration.slug : "",
          typeof right.configuration.slug === "string" ? right.configuration.slug : "",
        ),
      ),
  };
}

function validateSeed(
  blueprint: NpAgentSiteBlueprintV1,
  config: NpConfig,
  checkBlocks: (blocks: NpBlockContent) => void,
  checkRichText: (value: unknown) => void,
): void {
  const collections = new Map(
    config.collections.map((collection) => [collection.slug, collection]),
  );
  const documents = new Map(
    blueprint.seed.documents.map((document) => [document.documentId, document]),
  );
  const media = new Map(blueprint.seed.media.map((entry) => [entry.mediaId, entry]));
  const translations = new Set<string>();
  for (const document of documents.values()) {
    const collection = collections.get(document.collection);
    if (!collection)
      fail(
        "seed collections must be configured; principals and framework system collections are unsupported",
      );
    if (
      collection.i18n
        ? document.locale === null ||
          !config.i18n?.locales.includes(document.locale) ||
          document.translationGroupId === null
        : document.locale !== null || document.translationGroupId !== null
    )
      fail("seed locale and translation metadata must match the actual configured collection");
    if (document.translationGroupId !== null) {
      const key = `${document.collection}:${document.translationGroupId}:${document.locale}`;
      if (translations.has(key)) fail("one translation group cannot repeat a collection locale");
      translations.add(key);
    }
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
        fail("seed data cannot override framework document metadata");
    const parsed = getCollectionZodSchema(collection).safeParse(document.data);
    if (!parsed.success) fail("seed data must satisfy the owning static field schema");
    if (collection.slugField && !npIsCanonicalCollectionDocumentSlug(document.data.slug))
      fail("slug-enabled seed documents require an explicit canonical slug");
    const noDefaults = (before: unknown, after: unknown): void => {
      if (Array.isArray(after) && Array.isArray(before))
        after.forEach((value, index) => noDefaults(before[index], value));
      else if (after && typeof after === "object" && !(after instanceof Date)) {
        if (!before || typeof before !== "object" || Array.isArray(before))
          fail("seed data must explicitly supply defaulted fields");
        const original = before as Record<string, unknown>;
        if (Object.keys(original).some((key) => !Object.hasOwn(after, key)))
          fail("seed data contains fields outside the owning static schema");
        for (const [key, value] of Object.entries(after)) {
          if (!Object.hasOwn(original, key) && value !== undefined)
            fail("seed data must explicitly supply defaulted fields");
          if (Object.hasOwn(original, key)) noDefaults(original[key], value);
        }
      }
    };
    noDefaults(document.data, parsed.data);
    const references = new Set<string>();
    const walk = (fields: readonly NpFieldConfig[], data: Record<string, unknown>) => {
      for (const field of fields) {
        if (field.type === "row" || field.type === "collapsible") {
          walk(field.fields, data);
          continue;
        }
        const value = data[field.name];
        if (value === undefined || value === null) continue;
        if (field.type === "group") walk(field.fields, value as Record<string, unknown>);
        if (field.type === "array")
          for (const row of value as Record<string, unknown>[]) walk(field.fields, row);
        if (field.type === "blocks") checkBlocks(value as NpBlockContent);
        if (field.type === "richText") checkRichText(value);
        if (field.type === "relationship" || field.type === "upload") {
          const ids =
            field.type === "relationship" && field.hasMany
              ? (value as string[])
              : [value as string];
          for (const id of ids) {
            if (field.type === "upload") {
              if (media.get(id)?.materialization !== "staged")
                fail(
                  "uploads require allocated staged media; reference-only entries cannot be persisted",
                );
              continue;
            }
            const target = documents.get(id);
            const allowsMedia = Array.isArray(field.relationTo)
              ? field.relationTo.includes("media")
              : field.relationTo === "media";
            if (!target && allowsMedia && media.get(id)?.materialization === "staged") continue;
            if (
              !target ||
              !(Array.isArray(field.relationTo)
                ? field.relationTo.includes(target.collection)
                : field.relationTo === target.collection)
            )
              fail("seed relationships require allocated matching documents");
            references.add(id);
          }
        }
      }
    };
    walk(collection.fields, document.data);
    if (canonical([...references].sort(compare)) !== canonical(document.dependsOnDocumentIds))
      fail("seed dependencies must exactly match configured document references");
  }
}

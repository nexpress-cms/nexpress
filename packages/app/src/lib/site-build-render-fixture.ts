import {
  defineConfig,
  getCollectionZodSchema,
  npMatchPluginPageRoutePattern,
  type NpCollectionConfig,
  type NpConfig,
  type NpFieldConfig,
} from "@nexpress/core";
import { isNpRichTextContent } from "@nexpress/core/fields";
import { dispatchThemeRoute } from "@nexpress/next";
import type { NpTheme } from "@nexpress/theme";
import {
  npRequireAgentBuildRenderFixtureRefV1,
  npRequireAgentBuildRenderFixtureV1,
  type NpAgentBlueprintNavigation,
  type NpAgentBlueprintSeedPlan,
  type NpAgentDesignDirectionDraftV1,
} from "@nexpress/core/agent-contract";
import {
  npIsCanonicalCollectionDocumentSlug,
  npRequireCollectionJsonValue,
} from "@nexpress/core/collection-contract";
import { npAnalyzeBlockContent } from "@nexpress/blocks";
import {
  npResolveConfiguredBuildCatalogV1,
  type NpSiteBuildOwnerBindingV1,
} from "./site-build-catalog.js";
import { npValidateConfiguredBuildDirectionSetV1 } from "./site-build-proposal.js";

type Document = NpAgentBlueprintSeedPlan["documents"][number];

export interface NpConfiguredBuildRenderFixtureV1 {
  schemaVersion: "np.configured-build-render-fixture.v1";
  theme: { id: string; package: string; tokens: NpAgentDesignDirectionDraftV1["tokens"] };
  documents: NpAgentBlueprintSeedPlan["documents"];
  navigation: NpAgentBlueprintNavigation[];
  pageDocuments: Array<{
    pageId: string;
    documentId: string;
    collection: string;
    route: string;
    locale: string | null;
    audience: "public" | "member";
    templateId: string | null;
    sessionRequired?: "member" | "none";
    anonymousWithholdingRequired?: boolean;
    routeOwner?: {
      kind: "forum-post-detail";
      package: string;
      contentDigest: string;
      pattern: string;
      boardDocumentId: string;
    };
  }>;
  frontPageId: string | null;
}

const compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

function fail(message: string): never {
  throw new Error(`Invalid configured Build render fixture: ${message}`);
}

// All callers pass owner-validated, detached JSON. This comparison preserves
// array order and ignores only the insignificant ordering of object keys.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? fail("unsupported fixture value");
}

function topFields(fields: readonly NpFieldConfig[]): NpFieldConfig[] {
  return fields.flatMap((field) =>
    field.type === "row" || field.type === "collapsible" ? topFields(field.fields) : [field],
  );
}

function orderDocuments(documents: Document[]): Document[] {
  const pending = new Map(documents.map((document) => [document.documentId, document]));
  const ordered: Document[] = [];
  const done = new Set<string>();
  while (pending.size) {
    const next = [...pending.values()]
      .filter((document) => document.dependsOnDocumentIds.every((id) => done.has(id)))
      .sort(
        (left, right) =>
          compare(left.collection, right.collection) || compare(left.documentId, right.documentId),
      )[0];
    if (!next) fail("documents require a complete acyclic dependency graph");
    pending.delete(next.documentId);
    done.add(next.documentId);
    ordered.push(next);
  }
  return ordered;
}

function noImplicitDefaults(before: unknown, after: unknown): void {
  if (Array.isArray(after)) {
    if (!Array.isArray(before)) return;
    after.forEach((value, index) => noImplicitDefaults(before[index], value));
  } else if (after !== null && typeof after === "object" && !(after instanceof Date)) {
    if (before === null || typeof before !== "object" || Array.isArray(before))
      fail("fixture data must explicitly supply defaulted fields");
    const original = before as Record<string, unknown>;
    for (const [key, value] of Object.entries(after)) {
      if (!Object.hasOwn(original, key) && value !== undefined)
        fail("fixture data must explicitly supply defaulted fields");
      if (Object.hasOwn(original, key)) noImplicitDefaults(original[key], value);
    }
  }
}

function validateDocument(
  document: Document,
  config: NpCollectionConfig,
  documents: ReadonlyMap<string, Document>,
  locales: readonly string[],
  definitions: Parameters<typeof npAnalyzeBlockContent>[1],
): void {
  if (config.i18n) {
    if (
      document.locale === null ||
      !locales.includes(document.locale) ||
      document.translationGroupId === null
    )
      fail("localized documents require a configured locale and allocated translation group");
  } else if (document.locale !== null || document.translationGroupId !== null) {
    fail("nonlocalized documents must not carry locale or translation metadata");
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
  ]) {
    if (Object.hasOwn(document.data, key)) fail("document data must not override seed metadata");
  }
  if (config.slugField && !npIsCanonicalCollectionDocumentSlug(document.data.slug))
    fail("slug-enabled fixture documents require an explicit canonical slug");
  // Omitting forData deliberately avoids executable admin conditions. The
  // owning field schema does not execute ACLs, hooks or custom validators.
  const parsed = getCollectionZodSchema(config).safeParse(document.data);
  if (!parsed.success) fail("document data must satisfy configured static field schemas");
  noImplicitDefaults(document.data, parsed.data);
  const references = new Set<string>();
  const walk = (fields: readonly NpFieldConfig[], data: Record<string, unknown>): void => {
    for (const field of fields) {
      if (field.type === "row" || field.type === "collapsible") {
        walk(field.fields, data);
        continue;
      }
      const value = data[field.name];
      if (value === undefined || value === null) continue;
      if (field.type === "group") {
        walk(field.fields, value as Record<string, unknown>);
      } else if (field.type === "array") {
        for (const row of value as Array<Record<string, unknown>>) walk(field.fields, row);
      } else if (field.type === "blocks") {
        if (npAnalyzeBlockContent(value, definitions).length > 0)
          fail("fixture blocks must satisfy selected installed definitions");
      } else if (field.type === "relationship" || field.type === "upload") {
        const ids = field.type === "relationship" && field.hasMany ? value : [value];
        for (const id of ids as string[]) {
          const target = documents.get(id);
          if (
            !target ||
            !(Array.isArray(field.relationTo)
              ? field.relationTo.includes(target.collection)
              : target.collection === field.relationTo)
          )
            fail("relationship and upload ids must resolve to allocated matching collections");
          references.add(id);
        }
      }
    }
  };
  walk(config.fields, document.data);
  if (canonical([...references].sort(compare)) !== canonical(document.dependsOnDocumentIds))
    fail("declared dependencies must exactly match configured document references");
}

/**
 * Project synthetic fixtures onto ordinary configured page documents. This
 * validates declarations and data only: the host owns file byte/digest checks,
 * isolated saving through the collection pipeline, actual routing and rendering.
 */
export async function npPrepareConfiguredBuildRenderFixtureV1(
  configValue: unknown,
  sourceCapsuleValue: unknown,
  ownerBindings: readonly NpSiteBuildOwnerBindingV1[],
  briefValue: unknown,
  draftSetValue: unknown,
  directionId: string,
  fixtures: Array<{ sampleId: string; body: unknown }>,
): Promise<NpConfiguredBuildRenderFixtureV1> {
  const { catalog, set } = await npValidateConfiguredBuildDirectionSetV1(
    configValue,
    sourceCapsuleValue,
    ownerBindings,
    briefValue,
    draftSetValue,
    "draft",
  );
  const config = defineConfig(configValue as NpConfig);
  const direction = set.directions.find((entry) => entry.id === directionId);
  if (!direction) fail("selected direction must belong to the validated draft set");
  const theme = catalog.themes.find((entry) => entry.package === direction.themeBase);
  if (!theme) fail("selected theme must belong to the installed catalog");
  const resolved = await npResolveConfiguredBuildCatalogV1(
    configValue,
    sourceCapsuleValue,
    ownerBindings,
  );
  if (resolved.fingerprint !== set.discoveryFingerprint)
    fail("configured declarations changed during fixture projection");
  const selectedTheme = resolved.themes.find((entry) => entry.package === direction.themeBase);
  const definitions = selectedTheme?.definitions;
  if (!definitions) fail("selected theme definitions must remain available");
  const fixtureValues = npRequireCollectionJsonValue(fixtures);
  if (!Array.isArray(fixtureValues) || fixtureValues.length > 1000)
    fail("fixture inputs require a bounded sample inventory");
  if (Buffer.byteLength(canonical(fixtureValues)) > 4 * 1024 * 1024)
    fail("combined fixture inputs exceed the byte bound");
  const bySample = new Map<string, unknown>();
  for (const value of fixtureValues) {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "body,sampleId" ||
      typeof value.sampleId !== "string" ||
      bySample.has(value.sampleId)
    )
      fail("fixture inputs require unique exact sample ids and bodies");
    bySample.set(value.sampleId, value.body);
  }
  const samples = set.comparisonInputs.sampleContent;
  if (samples.length !== bySample.size || samples.some((sample) => !bySample.has(sample.id)))
    fail("fixture inputs must match the complete comparison sample inventory");
  const documents = new Map<string, Document>();
  const navigation = new Map<string, NpAgentBlueprintNavigation>();
  const primaryByPage = new Map<string, string>();
  const claimedFiles = new Map<string, { digest: string; body: string }>();
  for (const sample of samples) {
    const reference = npRequireAgentBuildRenderFixtureRefV1(sample.data);
    const fixture = npRequireAgentBuildRenderFixtureV1(bySample.get(sample.id));
    const body = canonical(fixture);
    const previousFile = claimedFiles.get(reference.stagedArtifactPath);
    if (previousFile && (previousFile.digest !== reference.digest || previousFile.body !== body))
      fail("one staged fixture path must not claim conflicting digests or bodies");
    claimedFiles.set(reference.stagedArtifactPath, { digest: reference.digest, body });
    if (!fixture.documents.some((document) => document.documentId === reference.pageDocumentId))
      fail("primary page document must occur in its referenced fixture body");
    if (primaryByPage.has(sample.pageId)) fail("each page requires exactly one primary sample");
    primaryByPage.set(sample.pageId, reference.pageDocumentId);
    for (const document of fixture.documents) {
      const previous = documents.get(document.documentId);
      if (previous && canonical(previous) !== canonical(document))
        fail("shared fixture document ids must have identical complete data");
      documents.set(document.documentId, structuredClone(document));
    }
    for (const entry of fixture.navigation) {
      if (!theme.navigationLocations.includes(entry.location))
        fail("navigation location must belong to the selected configured theme");
      const previous = navigation.get(entry.location);
      if (previous && canonical(previous) !== canonical(entry))
        fail("shared navigation locations must have identical complete data");
      navigation.set(entry.location, structuredClone(entry));
    }
  }
  if (documents.size > 1000) fail("merged fixture document inventory exceeds the bound");
  const selectedIds = new Set<string>();
  const pageDocuments: NpConfiguredBuildRenderFixtureV1["pageDocuments"] = [];
  const collections = new Map(
    config.collections.map((collection) => [collection.slug, collection]),
  );
  for (const page of set.comparisonInputs.informationArchitecture) {
    if (page.fixtureIds.length !== 1) fail("every IA page requires exactly one primary sample");
    const documentId = primaryByPage.get(page.pageId);
    const document = documentId === undefined ? undefined : documents.get(documentId);
    const binding = direction.pageBindings.find((entry) => entry.pageId === page.pageId);
    if (!document || !binding)
      fail("every IA page requires its primary document and direction binding");
    if (selectedIds.has(document.documentId))
      fail("one primary document must not own multiple IA pages");
    selectedIds.add(document.documentId);
    const collection = collections.get(document.collection);
    if (!collection) fail("primary collection must be configured");
    const routeOwners =
      selectedTheme?.routeOwners.filter(
        (entry) =>
          binding.source === "custom" &&
          entry.owner.postCollection.slug === document.collection &&
          `${entry.owner.postCollection.slug}.${entry.owner.templateId}` === binding.templateId,
      ) ?? [];
    if (routeOwners.length > 1) fail("primary route requires one exact host owner");
    const routeOwner = routeOwners[0];
    // Ordinary pages/blog helpers do not resolve a member principal or enforce
    // community audience. A cookie or private visibility flag cannot make
    // these routes a member preview. Plugin routes need their own source-owned
    // route/template/document adapter before this projector may claim support.
    if (page.audience !== "public" && !routeOwner)
      fail("member preview requires an explicitly supported session-aware route owner");
    if (
      !routeOwner &&
      ((document.data.visibility !== undefined && document.data.visibility !== "public") ||
        (collection.community?.audience === true && document.data.audience !== "public"))
    )
      fail("ordinary public primary documents require public visibility and audience");
    const template =
      binding.source === "custom"
        ? theme.templates.find((entry) => entry.id === binding.templateId)
        : null;
    if (document.collection !== (binding.source === "pattern" ? "pages" : template?.collection))
      fail("primary document collection must match its actual pattern or template owner");
    const segments = page.route.slice(1).split("/").filter(Boolean);
    const prefix = segments[0] && catalog.locales.includes(segments[0]) ? segments.shift()! : null;
    const routeLocale = prefix ?? catalog.defaultLocale;
    if (page.locale !== null && page.locale !== routeLocale)
      fail("IA locale must match the actual route locale");
    if (collection.i18n && document.locale !== routeLocale)
      fail("primary document locale must match the actual route locale");
    if (
      !routeOwner &&
      !collection.i18n &&
      page.locale !== null &&
      page.locale !== catalog.defaultLocale
    )
      fail("nonlocalized primary documents cannot claim another locale");
    let routeProof: NpConfiguredBuildRenderFixtureV1["pageDocuments"][number]["routeOwner"];
    if (routeOwner) {
      if (
        prefix === null &&
        ["admin", "api", "blog", "search", "u", "members"].includes(segments[0] ?? "")
      )
        fail("Forum fixture cannot claim a framework-owned dedicated route");
      const owner = routeOwner.owner;
      const path = `/${segments.join("/")}`;
      const params = npMatchPluginPageRoutePattern(owner.route.pattern, path);
      const boardId = document.data[owner.postBoardField];
      const board = typeof boardId === "string" ? documents.get(boardId) : undefined;
      if (
        !params ||
        params.postId !== document.documentId ||
        !board ||
        board.collection !== owner.boardCollection.slug ||
        params.boardKey !== board.data[owner.boardKeyField] ||
        board.data.slug !== params.boardKey
      )
        fail(
          "Forum primary document, board relation/key and actual route pattern must match exactly",
        );
      if (binding.blocks.length || !isNpRichTextContent(document.data.body))
        fail("Forum detail uses its actual rich-text body and cannot substitute selected blocks");
      if (
        document.data.visibility !== "public" ||
        board.data.visibility !== "public" ||
        document.data.audience !== (page.audience === "member" ? "members" : "public") ||
        !(
          board.data.audience === "public" ||
          (page.audience === "member" && board.data.audience === "members")
        ) ||
        typeof board.data[owner.boardSkinField] !== "string" ||
        !owner.skinIds.includes(board.data[owner.boardSkinField] as string)
      )
        fail(
          "Forum fixtures require exact public visibility, public/member audiences and a registered board skin",
        );
      const declaredTheme = config.themes?.find((entry) => entry.manifest.id === theme.id);
      if (!declaredTheme || dispatchThemeRoute(declaredTheme as NpTheme, segments.join("/")))
        fail("Forum fixture route must not be shadowed by an actual selected theme route");
      if (
        [...documents.values()].some(
          (entry) =>
            entry.collection === "pages" &&
            entry.data.slug === (segments.join("/") || "/") &&
            (!collections.get("pages")?.i18n || entry.locale === routeLocale),
        )
      )
        fail("Forum fixture route must not be shadowed by a primary or auxiliary pages document");
      for (const plugin of config.plugins ?? []) {
        const routes: unknown = Reflect.get(plugin, "pageRoutes");
        if (!Array.isArray(routes)) continue;
        for (const route of routes as Array<{ pattern: string }>)
          if (route !== owner.route && npMatchPluginPageRoutePattern(route.pattern, path))
            fail(
              "Forum fixture route must resolve without another configured plugin route collision",
            );
      }
      routeProof = {
        kind: "forum-post-detail",
        package: routeOwner.package,
        contentDigest: routeOwner.contentDigest,
        pattern: owner.route.pattern,
        boardDocumentId: board.documentId,
      };
    } else if (document.collection === "pages") {
      if (
        prefix === null &&
        ["admin", "api", "blog", "search", "u", "members"].includes(segments[0] ?? "")
      )
        fail("page fixture cannot claim a framework-owned dedicated route");
      const slug = segments.join("/") || "/";
      if (!collection.slugField || document.data.slug !== slug)
        fail("page slug must exactly match its ordinary catch-all route");
    } else if (document.collection === "posts") {
      if (
        prefix !== null ||
        segments.length !== 2 ||
        segments[0] !== "blog" ||
        document.data.slug !== segments[1] ||
        (document.data.kind !== undefined && document.data.kind !== "article")
      )
        fail("post fixtures require the ordinary article detail route");
    } else {
      fail("custom collection primary route requires an explicit supported route owner");
    }
    const fields = topFields(collection.fields);
    const blocksField = fields.find((field) => "name" in field && field.name === "blocks");
    if (blocksField && blocksField.type !== "blocks")
      fail("primary blocks field must use the blocks contract");
    if (!blocksField && binding.blocks.length)
      fail("selected blocks require a configured primary blocks field");
    if (
      Object.hasOwn(document.data, "blocks") &&
      canonical(document.data.blocks) !== canonical(binding.blocks)
    )
      fail("authored primary blocks must not contradict the selected direction");
    if (blocksField) document.data.blocks = npRequireCollectionJsonValue(binding.blocks);
    const templateId =
      binding.source === "custom" ? binding.templateId.slice(document.collection.length + 1) : null;
    const templateField = fields.find((field) => "name" in field && field.name === "template");
    if (templateField && templateField.type !== "text")
      fail("primary template field must be a text declaration");
    if (templateId !== null && !templateField && !routeOwner)
      fail("selected template requires a configured primary template field");
    const authoredTemplate = document.data.template;
    if (
      authoredTemplate !== undefined &&
      authoredTemplate !== null &&
      authoredTemplate !== "" &&
      authoredTemplate !== templateId
    )
      fail("authored primary template must not contradict the selected direction");
    if (templateField && !routeOwner) document.data.template = templateId;
    pageDocuments.push({
      pageId: page.pageId,
      documentId: document.documentId,
      collection: document.collection,
      route: page.route,
      locale: document.locale,
      audience: page.audience,
      templateId,
      ...(routeProof
        ? {
            sessionRequired: page.audience === "member" ? ("member" as const) : ("none" as const),
            anonymousWithholdingRequired: page.audience === "member",
            routeOwner: routeProof,
          }
        : {}),
    });
  }
  for (const document of documents.values()) {
    const collection = collections.get(document.collection);
    if (!collection) fail("every fixture collection must be configured");
    validateDocument(document, collection, documents, catalog.locales, definitions);
  }
  const walkNavigation = (items: NpAgentBlueprintNavigation["items"]): void => {
    for (const item of items) {
      if (item.type === "collection" && !collections.has(item.collection))
        fail("navigation collection references must be configured");
      if (item.type === "page") {
        const document = documents.get(item.pageId);
        if (!document || document.collection !== (item.collectionSlug ?? "pages"))
          fail("navigation page references must resolve to allocated matching documents");
      }
      if (item.children) walkNavigation(item.children);
    }
  };
  for (const entry of navigation.values()) walkNavigation(entry.items);
  return {
    schemaVersion: "np.configured-build-render-fixture.v1",
    theme: { id: theme.id, package: theme.package, tokens: structuredClone(direction.tokens) },
    documents: orderDocuments([...documents.values()]),
    navigation: [...navigation.values()].sort((left, right) =>
      compare(left.location, right.location),
    ),
    pageDocuments: pageDocuments.sort((left, right) => compare(left.pageId, right.pageId)),
    frontPageId: pageDocuments.find((page) => page.route === "/")?.documentId ?? null,
  };
}

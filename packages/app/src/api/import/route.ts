import {
  NpForbiddenError,
  NpValidationError,
  NP_DEFAULT_SITE_ID,
  can,
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionZodSchema,
  getCurrentSiteId,
  getPluginRegistration,
  getThemeById,
  invalidatePluginEnabled,
  npMedia,
  npNavigation,
  npPlugins,
  npSettings,
  npSites,
  npUsers,
  pluginConfigCacheTag,
  saveDocument,
  withDeferredPostCommit,
  type NpDocumentStatus,
} from "@nexpress/core";
import { npGetPersistedCollectionDocumentIds } from "@nexpress/core/collections";
import {
  npCollectionDocumentToWriteInput,
  npParseCollectionDocumentWire,
} from "@nexpress/core/collection-contract";
import {
  npCollectContentTransferMediaReferences,
  npCollectContentTransferRelationshipReferences,
  npCompareContentTransferText,
  npContentTransferContractLimits,
  npContentTransferDocumentKey,
  npOrderContentTransferDocumentEntries,
  npRemapContentTransferMediaReferences,
  npRequireContentTransferImportReport,
  type NpContentTransferDocument,
  type NpContentTransferDocumentEntry,
  type NpContentTransferEnvelope,
  type NpContentTransferImportCounts,
  type NpContentTransferPluginState,
} from "@nexpress/core/content-transfer";
import { npAnalyzeSettingValue } from "@nexpress/core/settings";
import { bustThemeCache, invalidateCacheTargets, navCacheTag, siteCacheTag } from "@nexpress/next";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { validateDocumentBlockContent } from "../../lib/block-content-validation";
import {
  npContentTransferValidationError,
  npReadContentTransferBody,
  npReadContentTransferQuery,
  npRequireContentTransferRequestValue,
  npSummarizeContentTransferValues,
} from "../../lib/content-transfer";
import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

const MEDIA_QUERY_CHUNK = 500;

interface PreparedDocument extends NpContentTransferDocumentEntry {
  writable: Record<string, unknown>;
  status: NpDocumentStatus;
  exists: boolean;
}

interface PreparedPlugin {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  configVersion: number;
}

function contentTransferDocumentId(document: NpContentTransferDocument): string {
  if (typeof document.id !== "string") {
    throw npContentTransferValidationError("Invalid content transfer document", [
      { field: "collections", message: "Every transferred document must have a string id." },
    ]);
  }
  return document.id;
}

function assertRegisteredFilter(
  filter: readonly string[] | null,
  registered: ReadonlySet<string>,
  payload: NpContentTransferEnvelope,
): void {
  const unknown = filter?.filter((slug) => !registered.has(slug)) ?? [];
  if (unknown.length > 0) {
    throw npContentTransferValidationError("Invalid content transfer query", [
      {
        field: "collections",
        message: `Unknown collection(s): ${npSummarizeContentTransferValues(unknown)}`,
      },
    ]);
  }
  const missing = filter?.filter((slug) => !Object.hasOwn(payload.collections, slug)) ?? [];
  if (missing.length > 0) {
    throw npContentTransferValidationError("Invalid content transfer query", [
      {
        field: "collections",
        message: `Collection(s) are not present in the transfer: ${npSummarizeContentTransferValues(missing)}`,
      },
    ]);
  }
}

function normalizeFrameworkSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(settings)) {
    if (key === "activeTheme" && (typeof value !== "string" || !getThemeById(value))) {
      throw new NpValidationError("Invalid content transfer", [
        {
          field: "settings.activeTheme",
          message: `Theme '${String(value)}' is not registered.`,
        },
      ]);
    }
    if (!key.startsWith("theme.settings:")) continue;
    const themeId = key.slice("theme.settings:".length);
    const theme = getThemeById(themeId);
    if (!theme) {
      throw new NpValidationError("Invalid content transfer", [
        { field: `settings.${key}`, message: `Theme '${themeId}' is not registered.` },
      ]);
    }
    const envelope = value as { __npVersion: unknown; __npSettings: unknown };
    const expectedVersion = theme.manifest.settingsVersion ?? 1;
    if (envelope.__npVersion !== expectedVersion) {
      throw new NpValidationError("Invalid content transfer", [
        {
          field: `settings.${key}.__npVersion`,
          message: `Theme '${themeId}' settings must use version ${expectedVersion.toString()}.`,
        },
      ]);
    }
    const schema = theme.manifest.settingsSchema as
      | {
          safeParse(
            input: unknown,
          ): { success: true; data: unknown } | { success: false; error?: { message: string } };
        }
      | undefined;
    if (!schema) {
      throw new NpValidationError("Invalid content transfer", [
        {
          field: `settings.${key}`,
          message: `Theme '${themeId}' does not declare settingsSchema.`,
        },
      ]);
    }
    const parsed = schema.safeParse(envelope.__npSettings);
    if (!parsed.success) {
      throw new NpValidationError("Invalid content transfer", [
        {
          field: `settings.${key}`,
          message: parsed.error?.message ?? "Theme settings failed validation",
        },
      ]);
    }
    normalized[key] = { __npVersion: expectedVersion, __npSettings: parsed.data };
    const issues = npAnalyzeSettingValue(key, normalized[key]);
    if (issues.length > 0) {
      throw new NpValidationError(
        "Invalid content transfer",
        issues.map((issue) => ({ field: issue.path, message: issue.message })),
      );
    }
  }
  return normalized;
}

async function preparePlugins(
  plugins: readonly NpContentTransferPluginState[],
  addWarning: (message: string) => void,
): Promise<PreparedPlugin[]> {
  const db = getDb();
  const installed = new Set(
    (await db.select({ id: npPlugins.id }).from(npPlugins)).map((row) => row.id),
  );
  const prepared: PreparedPlugin[] = [];
  for (const plugin of plugins) {
    if (!installed.has(plugin.id)) {
      addWarning(`Plugin '${plugin.id}' was not imported because it is not installed.`);
      continue;
    }
    const registration = getPluginRegistration(plugin.id);
    if (!registration) {
      throw new NpValidationError("Invalid content transfer", [
        {
          field: `plugins.${plugin.id}`,
          message: `Plugin '${plugin.id}' is installed but not loaded from nexpress.config.ts.`,
        },
      ]);
    }
    if (plugin.manifestVersion !== null && plugin.manifestVersion !== registration.version) {
      addWarning(
        `Plugin '${plugin.id}' was exported at ${plugin.manifestVersion} and is loaded at ${registration.version ?? "an unversioned build"}.`,
      );
    }
    const schema = registration.configSchema as
      | {
          safeParse(
            input: unknown,
          ): { success: true; data: unknown } | { success: false; error?: { message: string } };
        }
      | undefined;
    const parsed = schema?.safeParse(plugin.config);
    if (parsed && !parsed.success) {
      throw new NpValidationError("Invalid content transfer", [
        {
          field: `plugins.${plugin.id}.config`,
          message: parsed.error?.message ?? "Plugin config failed its registered schema.",
        },
      ]);
    }
    const config = parsed?.success ? parsed.data : plugin.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new NpValidationError("Invalid content transfer", [
        { field: `plugins.${plugin.id}.config`, message: "Plugin config must be an object." },
      ]);
    }
    const configVersion = schema ? (registration.configVersion ?? 1) : 1;
    const settingIssues = npAnalyzeSettingValue(`plugin.config:${plugin.id}`, {
      __npVersion: configVersion,
      __npSettings: config,
    });
    if (settingIssues.length > 0) {
      throw new NpValidationError(
        "Invalid content transfer",
        settingIssues.map((issue) => ({
          field: `plugins.${plugin.id}.config`,
          message: issue.message,
        })),
      );
    }
    prepared.push({
      id: plugin.id,
      enabled: plugin.enabled,
      config: config as Record<string, unknown>,
      configVersion,
    });
  }
  return prepared;
}

async function resolveMedia(
  payload: NpContentTransferEnvelope,
  referencedIds: ReadonlySet<string>,
  addWarning: (message: string) => void,
): Promise<Map<string, string | null>> {
  const manifest = new Map(payload.media.map((item) => [item.id, item]));
  const missing = [...referencedIds].filter((id) => !manifest.has(id));
  if (missing.length > 0) {
    throw npContentTransferValidationError("Invalid content transfer", [
      {
        field: "media",
        message: `Document references are missing from the media manifest: ${npSummarizeContentTransferValues(missing)}`,
      },
    ]);
  }

  const selected = [...referencedIds]
    .map((id) => manifest.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((left, right) => npCompareContentTransferText(left.id, right.id));
  const db = getDb();
  const rows: Array<{ id: string; filename: string; hash: string; mimeType: string }> = [];
  const hashes = [...new Set(selected.map((item) => item.hash))];
  for (let index = 0; index < hashes.length; index += MEDIA_QUERY_CHUNK) {
    const chunk = hashes.slice(index, index + MEDIA_QUERY_CHUNK);
    rows.push(
      ...(await db
        .select({
          id: npMedia.id,
          filename: npMedia.filename,
          hash: npMedia.hash,
          mimeType: npMedia.mimeType,
        })
        .from(npMedia)
        .where(and(inArray(npMedia.hash, chunk), isNull(npMedia.deletedAt)))
        .orderBy(asc(npMedia.id))),
    );
  }
  const byHash = new Map<string, typeof rows>();
  for (const row of rows) {
    const matches = byHash.get(row.hash) ?? [];
    matches.push(row);
    byHash.set(row.hash, matches);
  }

  const unresolved = selected.filter((item) => !byHash.has(item.hash));
  const filenameRows: typeof rows = [];
  const filenames = [...new Set(unresolved.map((item) => item.filename))];
  for (let index = 0; index < filenames.length; index += MEDIA_QUERY_CHUNK) {
    const chunk = filenames.slice(index, index + MEDIA_QUERY_CHUNK);
    filenameRows.push(
      ...(await db
        .select({
          id: npMedia.id,
          filename: npMedia.filename,
          hash: npMedia.hash,
          mimeType: npMedia.mimeType,
        })
        .from(npMedia)
        .where(and(inArray(npMedia.filename, chunk), isNull(npMedia.deletedAt)))
        .orderBy(asc(npMedia.id))),
    );
  }
  const byFilenameAndType = new Map<string, typeof rows>();
  for (const row of filenameRows) {
    const key = `${row.filename}\u0000${row.mimeType}`;
    const matches = byFilenameAndType.get(key) ?? [];
    matches.push(row);
    byFilenameAndType.set(key, matches);
  }

  const replacements = new Map<string, string | null>();
  const ambiguous: Array<{ field: string; message: string }> = [];
  for (const item of selected) {
    const hashMatches = byHash.get(item.hash) ?? [];
    const hashMatch = hashMatches.find((row) => row.id === item.id) ?? hashMatches[0];
    if (hashMatches.length === 1 || hashMatches.some((row) => row.id === item.id)) {
      replacements.set(item.id, hashMatch?.id ?? null);
      continue;
    }
    if (hashMatches.length > 1) {
      ambiguous.push({
        field: `media.${item.id}`,
        message:
          "Multiple active target media rows share this hash and none preserves the source id.",
      });
      continue;
    }
    const filenameMatches = byFilenameAndType.get(`${item.filename}\u0000${item.mimeType}`) ?? [];
    const filenameMatch = filenameMatches.find((row) => row.id === item.id) ?? filenameMatches[0];
    if (filenameMatches.length === 1 || filenameMatches.some((row) => row.id === item.id)) {
      replacements.set(item.id, filenameMatch?.id ?? null);
      addWarning(`Media '${item.id}' was matched by filename and MIME type fallback.`);
      continue;
    }
    if (filenameMatches.length > 1) {
      ambiguous.push({
        field: `media.${item.id}`,
        message:
          "Multiple active target media rows share this filename and MIME type and none preserves the source id.",
      });
      continue;
    }
    replacements.set(item.id, null);
    addWarning(`Media '${item.id}' was not matched; its schema-owned references were cleared.`);
  }
  if (ambiguous.length > 0) {
    throw npContentTransferValidationError("Ambiguous content transfer media", ambiguous);
  }
  return replacements;
}

async function existingDocumentKeys(
  entries: readonly PreparedDocument[],
  siteId: string,
): Promise<Set<string>> {
  const idsByCollection = new Map<string, string[]>();
  for (const entry of entries) {
    const ids = idsByCollection.get(entry.collection) ?? [];
    ids.push(entry.documentId);
    idsByCollection.set(entry.collection, ids);
  }
  const keys = new Set<string>();
  for (const [collection, ids] of idsByCollection) {
    const existing = await npGetPersistedCollectionDocumentIds(collection, ids, siteId);
    for (const id of existing) keys.add(npContentTransferDocumentKey(collection, id));
  }
  return keys;
}

async function assertExternalRelationshipTargets(
  entries: readonly PreparedDocument[],
  existingKeys: ReadonlySet<string>,
  registered: ReadonlySet<string>,
  siteId: string,
): Promise<void> {
  const entryKeys = new Set(
    entries.map((entry) => npContentTransferDocumentKey(entry.collection, entry.documentId)),
  );
  const referencesByCollection = new Map<string, Map<string, string>>();
  const frameworkReferences = new Map<"media" | "users", Map<string, string>>();
  for (const entry of entries) {
    for (const reference of npCollectContentTransferRelationshipReferences(
      entry.fields,
      entry.document,
      `collections.${entry.collection}.${entry.documentId}`,
    )) {
      const key = npContentTransferDocumentKey(reference.collection, reference.documentId);
      if (entryKeys.has(key) || existingKeys.has(key)) continue;
      if (reference.collection === "media" || reference.collection === "users") {
        const refs = frameworkReferences.get(reference.collection) ?? new Map<string, string>();
        refs.set(reference.documentId, reference.path);
        frameworkReferences.set(reference.collection, refs);
        continue;
      }
      if (!registered.has(reference.collection)) continue;
      const refs = referencesByCollection.get(reference.collection) ?? new Map<string, string>();
      refs.set(reference.documentId, reference.path);
      referencesByCollection.set(reference.collection, refs);
    }
  }

  const missing: Array<{ field: string; message: string }> = [];
  for (const [collection, references] of referencesByCollection) {
    const ids = [...references.keys()];
    const found = new Set<string>();
    for (let index = 0; index < ids.length; index += 10_000) {
      for (const id of await npGetPersistedCollectionDocumentIds(
        collection,
        ids.slice(index, index + 10_000),
        siteId,
      )) {
        found.add(id);
      }
    }
    for (const [id, path] of references) {
      if (!found.has(id)) {
        missing.push({
          field: path,
          message: `Relationship target '${collection}:${id}' is neither transferred nor present on the target site.`,
        });
      }
    }
  }
  for (const [collection, references] of frameworkReferences) {
    const ids = [...references.keys()];
    const found = new Set<string>();
    for (let index = 0; index < ids.length; index += 10_000) {
      const chunk = ids.slice(index, index + 10_000);
      const rows =
        collection === "users"
          ? await getDb().select({ id: npUsers.id }).from(npUsers).where(inArray(npUsers.id, chunk))
          : await getDb()
              .select({ id: npMedia.id })
              .from(npMedia)
              .where(and(inArray(npMedia.id, chunk), isNull(npMedia.deletedAt)));
      for (const row of rows) found.add(row.id);
    }
    for (const [id, path] of references) {
      if (!found.has(id)) {
        missing.push({
          field: path,
          message: `Relationship target '${collection}:${id}' is not present on the target instance.`,
        });
      }
    }
  }
  if (missing.length > 0) {
    throw npContentTransferValidationError("Invalid content transfer", missing);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) throw new NpForbiddenError("import", "create");

    await ensureFor("write");
    const query = npReadContentTransferQuery(request, { allowDryRun: true });
    const payload = await npReadContentTransferBody(request);
    const registeredSlugs = new Set(getAllCollectionSlugs());
    assertRegisteredFilter(query.collections, registeredSlugs, payload);
    const filter = query.collections ? new Set(query.collections) : null;
    const partial = payload.partial || filter !== null;
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const db = getDb();
    const targetSites = await db
      .select({ id: npSites.id })
      .from(npSites)
      .where(eq(npSites.id, siteId))
      .limit(1);
    if (targetSites.length !== 1) {
      throw npContentTransferValidationError("Invalid content transfer target", [
        { field: "site", message: `Target site '${siteId}' does not exist.` },
      ]);
    }

    const warnings: string[] = [];
    const addWarning = (message: string): void => {
      if (warnings.length >= npContentTransferContractLimits.warnings) {
        throw new NpValidationError("Content transfer has too many portability warnings", [
          {
            field: "warnings",
            message: `Resolve transfer differences before exceeding ${npContentTransferContractLimits.warnings.toString()} warnings.`,
          },
        ]);
      }
      warnings.push(message);
    };

    const unknownPayloadCollections = payload.collectionsExported.filter(
      (slug) => !registeredSlugs.has(slug),
    );
    if (unknownPayloadCollections.length > 0) {
      throw npContentTransferValidationError("Invalid content transfer", [
        {
          field: "collections",
          message: `Collection(s) are not registered on this target: ${npSummarizeContentTransferValues(unknownPayloadCollections)}`,
        },
      ]);
    }
    const selectedCollections = new Map<string, NpContentTransferDocument[]>();
    for (const slug of payload.collectionsExported) {
      if (filter && !filter.has(slug)) continue;
      const documents = payload.collections[slug];
      if (!documents) {
        throw npContentTransferValidationError("Invalid content transfer", [
          { field: `collections.${slug}`, message: "Inventory entry has no collection payload." },
        ]);
      }
      selectedCollections.set(slug, documents);
    }
    if (filter && !payload.partial) {
      addWarning(
        "The collections query selected content only; full site, theme, settings, navigation, and plugin sections were ignored.",
      );
    }

    const referencedMediaIds = new Set<string>();
    for (const [slug, documents] of selectedCollections) {
      const config = getCollectionConfig(slug);
      for (const document of documents) {
        const documentId = contentTransferDocumentId(document);
        for (const reference of npCollectContentTransferMediaReferences(
          config.fields,
          document,
          `collections.${slug}.${documentId}`,
        )) {
          referencedMediaIds.add(reference.mediaId);
        }
      }
    }
    const unusedMedia = payload.media
      .map((item) => item.id)
      .filter((id) => !referencedMediaIds.has(id));
    if (!filter && unusedMedia.length > 0) {
      throw npContentTransferValidationError("Invalid content transfer", [
        {
          field: "media",
          message: `Media manifest contains unreferenced item(s): ${npSummarizeContentTransferValues(unusedMedia)}`,
        },
      ]);
    }
    const mediaMap = await resolveMedia(payload, referencedMediaIds, addWarning);

    const preparedDocuments: PreparedDocument[] = [];
    const documentKeys = new Set<string>();
    for (const [slug, documents] of selectedCollections) {
      const config = getCollectionConfig(slug);
      for (const document of documents) {
        const sourceDocumentId = contentTransferDocumentId(document);
        const transformed = npRemapContentTransferMediaReferences(
          config.fields,
          document,
          mediaMap,
        );
        let runtimeDocument: Record<string, unknown>;
        let writable: Record<string, unknown>;
        try {
          runtimeDocument = npParseCollectionDocumentWire(transformed, config);
          writable = npCollectionDocumentToWriteInput(runtimeDocument, config);
          writable = getCollectionZodSchema(config, writable).parse(writable) as Record<
            string,
            unknown
          >;
          validateDocumentBlockContent(slug, writable);
        } catch (error) {
          throw new NpValidationError("Invalid content transfer document", [
            {
              field: `collections.${slug}.${sourceDocumentId}`,
              message: error instanceof Error ? error.message : "Document validation failed.",
            },
          ]);
        }
        const documentId = sourceDocumentId;
        const key = npContentTransferDocumentKey(slug, documentId);
        if (documentKeys.has(key)) {
          throw new NpValidationError("Invalid content transfer", [
            { field: `collections.${slug}`, message: `Document id '${documentId}' is repeated.` },
          ]);
        }
        documentKeys.add(key);
        preparedDocuments.push({
          collection: slug,
          documentId,
          document: transformed as NpContentTransferDocument,
          fields: config.fields,
          writable,
          status: runtimeDocument.status as NpDocumentStatus,
          exists: false,
        });
      }
    }

    const existingKeys = await existingDocumentKeys(preparedDocuments, siteId);
    for (const entry of preparedDocuments) {
      entry.exists = existingKeys.has(
        npContentTransferDocumentKey(entry.collection, entry.documentId),
      );
    }
    await assertExternalRelationshipTargets(
      preparedDocuments,
      existingKeys,
      registeredSlugs,
      siteId,
    );
    const orderedDocuments = npRequireContentTransferRequestValue(() =>
      npOrderContentTransferDocumentEntries(preparedDocuments, existingKeys),
    );

    let normalizedSettings: Record<string, unknown> = {};
    let preparedPlugins: PreparedPlugin[] = [];
    if (!partial && !payload.partial) {
      normalizedSettings = normalizeFrameworkSettings(payload.settings);
      preparedPlugins = await preparePlugins(payload.plugins, addWarning);
    }

    const imported: NpContentTransferImportCounts = {
      site: !partial && !payload.partial ? 1 : 0,
      theme: !partial && !payload.partial ? 1 : 0,
      settings: !partial && !payload.partial ? Object.keys(normalizedSettings).length : 0,
      navigation: !partial && !payload.partial ? Object.keys(payload.navigation).length : 0,
      documentsCreated: orderedDocuments.filter((entry) => !entry.exists).length,
      documentsUpdated: orderedDocuments.filter((entry) => entry.exists).length,
      mediaMatched: [...mediaMap.values()].filter((id) => id !== null).length,
      pluginsUpdated: preparedPlugins.length,
    };

    let previousNavigationLocations: string[] = [];
    if (!query.dryRun) {
      await withDeferredPostCommit(async () => {
        await db.transaction(async (tx) => {
          const now = new Date();
          for (const entry of orderedDocuments) {
            await saveDocument(
              entry.collection,
              entry.exists ? entry.documentId : null,
              entry.writable,
              user,
              {
                status: entry.status,
                tx,
                ...(!entry.exists ? { createId: entry.documentId } : {}),
              },
            );
          }

          if (partial || payload.partial) return;
          const updatedSites = await tx
            .update(npSites)
            .set({
              name: payload.site.name,
              description: payload.site.description,
              settings: {
                siteUrl: payload.site.url,
                defaultLocale: payload.site.defaultLocale,
                timezone: payload.site.timezone,
              },
              updatedAt: now,
            })
            .where(eq(npSites.id, siteId))
            .returning({ id: npSites.id });
          if (updatedSites.length !== 1) {
            throw npContentTransferValidationError("Invalid content transfer target", [
              { field: "site", message: `Target site '${siteId}' no longer exists.` },
            ]);
          }

          if (payload.theme === null) {
            await tx
              .delete(npSettings)
              .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "theme")));
          } else {
            await tx
              .insert(npSettings)
              .values({
                siteId,
                key: "theme",
                value: payload.theme,
                updatedAt: now,
                updatedBy: user.id,
              })
              .onConflictDoUpdate({
                target: [npSettings.siteId, npSettings.key],
                set: { value: payload.theme, updatedAt: now, updatedBy: user.id },
              });
          }

          const currentPortableSettings = (
            await tx
              .select({ key: npSettings.key })
              .from(npSettings)
              .where(eq(npSettings.siteId, siteId))
          )
            .map((row) => row.key)
            .filter(
              (key) =>
                key !== "theme" && key !== "jobs.paused" && !key.startsWith("plugin.config:"),
            );
          for (const key of currentPortableSettings) {
            if (!Object.hasOwn(normalizedSettings, key)) {
              await tx
                .delete(npSettings)
                .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, key)));
            }
          }
          for (const [key, value] of Object.entries(normalizedSettings)) {
            await tx
              .insert(npSettings)
              .values({ siteId, key, value, updatedAt: now, updatedBy: user.id })
              .onConflictDoUpdate({
                target: [npSettings.siteId, npSettings.key],
                set: { value, updatedAt: now, updatedBy: user.id },
              });
          }

          previousNavigationLocations = (
            await tx
              .delete(npNavigation)
              .where(eq(npNavigation.siteId, siteId))
              .returning({ location: npNavigation.location })
          ).map((row) => row.location);
          for (const [location, items] of Object.entries(payload.navigation)) {
            await tx.insert(npNavigation).values({
              siteId,
              location,
              items,
              updatedAt: now,
              updatedBy: user.id,
            });
          }

          for (const plugin of preparedPlugins) {
            await tx
              .insert(npSettings)
              .values({
                siteId,
                key: `plugin.config:${plugin.id}`,
                value: {
                  __npVersion: plugin.configVersion,
                  __npSettings: plugin.config,
                },
                updatedAt: now,
                updatedBy: user.id,
              })
              .onConflictDoUpdate({
                target: [npSettings.siteId, npSettings.key],
                set: {
                  value: {
                    __npVersion: plugin.configVersion,
                    __npSettings: plugin.config,
                  },
                  updatedAt: now,
                  updatedBy: user.id,
                },
              });
            const updatedPlugins = await tx
              .update(npPlugins)
              .set({ enabled: plugin.enabled, updatedAt: now })
              .where(eq(npPlugins.id, plugin.id))
              .returning({ id: npPlugins.id });
            if (updatedPlugins.length !== 1) {
              throw npContentTransferValidationError("Invalid content transfer target", [
                {
                  field: `plugins.${plugin.id}`,
                  message: `Plugin '${plugin.id}' is no longer installed.`,
                },
              ]);
            }
          }
        });

        if (!partial && !payload.partial) {
          for (const plugin of preparedPlugins) invalidatePluginEnabled(plugin.id);
          const navigationLocations = new Set([
            ...previousNavigationLocations,
            ...Object.keys(payload.navigation),
          ]);
          for (const location of navigationLocations) {
            await invalidateCacheTargets({
              source: "navigation",
              siteId,
              navigationLocation: location,
              tags: [navCacheTag(siteId, location)],
              paths: [{ path: "/", type: "layout" }],
            });
          }
          await invalidateCacheTargets({
            source: "site",
            siteId,
            tags: [siteCacheTag(siteId), `nx:sitemap:${siteId}`, `nx:feed:${siteId}`],
            paths: [{ path: "/", type: "layout" }],
          });
          await bustThemeCache(siteId);
          for (const plugin of preparedPlugins) {
            await invalidateCacheTargets({
              source: "plugin-config",
              siteId,
              pluginId: plugin.id,
              tags: [pluginConfigCacheTag(plugin.id)],
            });
          }
        }
      });
    }

    const report = npRequireContentTransferRequestValue(() =>
      npRequireContentTransferImportReport({
        imported,
        warnings,
        dryRun: query.dryRun,
        partial,
      }),
    );
    return npSuccessResponse(report);
  } catch (error) {
    const normalized =
      error instanceof NpValidationError
        ? npContentTransferValidationError(error.message, error.errors)
        : error;
    return npErrorResponse(normalized instanceof Error ? normalized : new Error("Unknown error"));
  }
}

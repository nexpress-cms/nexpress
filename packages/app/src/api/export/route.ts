import {
  NpForbiddenError,
  NpValidationError,
  NP_DEFAULT_SITE_ID,
  can,
  findDocuments,
  getAllCollectionSlugs,
  getCollectionConfig,
  getCurrentSiteId,
  getPluginConfig,
  getPluginRegistration,
  getSiteGeneralSettings,
  getThemeById,
  getThemeSettingsWithStatus,
  listPluginStates,
  npMedia,
  npNavigation,
  npSettings,
} from "@nexpress/core";
import { npSerializeCollectionDocumentWithDiagnostics } from "@nexpress/core/collections";
import {
  NP_CONTENT_TRANSFER_VERSION,
  npCollectContentTransferMediaReferences,
  npCompareContentTransferText,
  npContentTransferContractLimits,
  npRequireContentTransferEnvelope,
  type NpContentTransferCollections,
  type NpContentTransferEnvelope,
  type NpContentTransferMediaItem,
} from "@nexpress/core/content-transfer";
import { npAnalyzeNavigationItems, npAnalyzeNavigationLocation } from "@nexpress/core/navigation";
import { npAnalyzeSettingRecord } from "@nexpress/core/settings";
import { npAnalyzeThemeTokensOverlay } from "@nexpress/core/theme";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import {
  npContentTransferValidationError,
  npReadContentTransferQuery,
  npRequireContentTransferRequestValue,
  npSummarizeContentTransferValues,
} from "../../lib/content-transfer";
import { getDb } from "../../lib/db";
import { ensureFor } from "../../lib/init-core";

const MEDIA_QUERY_CHUNK = 500;

function serializedDocumentId(document: Record<string, unknown>, collection: string): string {
  if (typeof document.id !== "string") {
    throw npContentTransferValidationError("Invalid stored collection document", [
      {
        field: `collections.${collection}`,
        message: "Serialized document is missing its canonical string id.",
      },
    ]);
  }
  return document.id;
}

function assertRegisteredCollections(
  requested: readonly string[] | null,
  registered: ReadonlySet<string>,
): void {
  const unknown = requested?.filter((slug) => !registered.has(slug)) ?? [];
  if (unknown.length > 0) {
    throw npContentTransferValidationError("Invalid content transfer query", [
      {
        field: "collections",
        message: `Unknown collection(s): ${npSummarizeContentTransferValues(unknown)}`,
      },
    ]);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) throw new NpForbiddenError("export", "read");

    await ensureFor("plugins");
    const db = getDb();
    const query = npReadContentTransferQuery(request, { allowDryRun: false });
    const registeredSlugs = new Set(getAllCollectionSlugs());
    assertRegisteredCollections(query.collections, registeredSlugs);
    const exportSlugs = [...(query.collections ?? registeredSlugs)].sort(
      npCompareContentTransferText,
    );
    const partial = query.collections !== null;
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const site = await getSiteGeneralSettings(siteId);

    const settingsRows = partial
      ? []
      : await db.select().from(npSettings).where(eq(npSettings.siteId, siteId));
    const navigationRows = partial
      ? []
      : await db.select().from(npNavigation).where(eq(npNavigation.siteId, siteId));
    const pluginRows = partial ? [] : await listPluginStates(db, siteId);
    const pluginStateIds = new Set(pluginRows.map((row) => row.id));

    const storedTheme = settingsRows.find((row) => row.key === "theme")?.value;
    const themeIssues = storedTheme === undefined ? [] : npAnalyzeThemeTokensOverlay(storedTheme);
    if (themeIssues.length > 0) {
      throw npContentTransferValidationError(
        "Invalid stored theme tokens",
        themeIssues.map((issue) => ({
          field: issue.path.replace(/^theme/u, "settings.theme"),
          message: issue.message,
        })),
      );
    }

    const exportedSettingRows = settingsRows
      .filter((row) => row.key !== "theme" && !row.key.startsWith("plugin.config:"))
      .sort((left, right) => npCompareContentTransferText(left.key, right.key));
    for (const row of settingsRows.filter((entry) => entry.key.startsWith("plugin.config:"))) {
      const pluginId = row.key.slice("plugin.config:".length);
      if (!getPluginRegistration(pluginId)) {
        throw new NpValidationError("Invalid stored settings", [
          {
            field: `settings.${row.key}`,
            message: `Plugin '${pluginId}' is not loaded from nexpress.config.ts.`,
          },
        ]);
      }
      if (!pluginStateIds.has(pluginId)) {
        throw new NpValidationError("Invalid stored settings", [
          {
            field: `settings.${row.key}`,
            message: `Plugin '${pluginId}' has config but no np_plugins state row.`,
          },
        ]);
      }
      await getPluginConfig(pluginId);
    }
    const settingIssues = exportedSettingRows.flatMap((row) =>
      npAnalyzeSettingRecord(row.siteId, row.key, row.value).map((issue) => ({
        field: issue.path,
        message: issue.message,
      })),
    );
    if (settingIssues.length > 0) {
      throw npContentTransferValidationError("Invalid stored settings", settingIssues);
    }

    const canonicalSettingValues = new Map<string, unknown>();
    for (const row of exportedSettingRows) {
      if (
        row.key === "activeTheme" &&
        (typeof row.value !== "string" || !getThemeById(row.value))
      ) {
        throw new NpValidationError("Invalid stored settings", [
          {
            field: "settings.activeTheme",
            message: `Theme '${String(row.value)}' is not registered.`,
          },
        ]);
      }
      if (row.key.startsWith("theme.settings:")) {
        const themeId = row.key.slice("theme.settings:".length);
        const registeredTheme = getThemeById(themeId);
        if (!registeredTheme) {
          throw new NpValidationError("Invalid stored settings", [
            {
              field: `settings.${row.key}`,
              message: `Theme '${themeId}' is not registered.`,
            },
          ]);
        }
        const status = await getThemeSettingsWithStatus(themeId);
        canonicalSettingValues.set(row.key, {
          __npVersion: registeredTheme.manifest.settingsVersion ?? 1,
          __npSettings: status.value,
        });
      }
    }
    const settings = Object.fromEntries(
      exportedSettingRows.map((row) => [row.key, canonicalSettingValues.get(row.key) ?? row.value]),
    );

    const navigationIssues = navigationRows.flatMap((row) => [
      ...npAnalyzeNavigationLocation(row.location).map((issue) => ({
        field: issue.path.replace(/^navigation\.location/u, `navigation.${row.location}`),
        message: issue.message,
      })),
      ...npAnalyzeNavigationItems(row.items).map((issue) => ({
        field: issue.path.replace(/^navigation\.items/u, `navigation.${row.location}`),
        message: issue.message,
      })),
    ]);
    if (navigationIssues.length > 0) {
      throw npContentTransferValidationError("Invalid stored navigation", navigationIssues);
    }
    const navigation = Object.fromEntries(
      navigationRows
        .sort((left, right) => npCompareContentTransferText(left.location, right.location))
        .map((row) => [row.location, row.items]),
    );

    const collections: NpContentTransferCollections = {};
    const referencedMediaIds = new Set<string>();
    let documentCount = 0;
    for (const slug of exportSlugs) {
      const result = await findDocuments(
        slug,
        { limit: npContentTransferContractLimits.documentsPerCollection, sort: "id" },
        user,
      );
      if (result.totalDocs > npContentTransferContractLimits.documentsPerCollection) {
        throw new NpValidationError("Content transfer is too large", [
          {
            field: `collections.${slug}`,
            message: `Contains ${result.totalDocs.toString()} documents; the v3 limit is ${npContentTransferContractLimits.documentsPerCollection.toString()}.`,
          },
        ]);
      }
      documentCount += result.docs.length;
      if (documentCount > npContentTransferContractLimits.documentsTotal) {
        throw new NpValidationError("Content transfer is too large", [
          {
            field: "collections",
            message: `Contains more than ${npContentTransferContractLimits.documentsTotal.toString()} documents; export fewer collections.`,
          },
        ]);
      }
      const config = getCollectionConfig(slug);
      const documents = result.docs
        .map((document) =>
          npSerializeCollectionDocumentWithDiagnostics<Record<string, unknown>>(document, config),
        )
        .sort((left, right) =>
          npCompareContentTransferText(
            serializedDocumentId(left, slug),
            serializedDocumentId(right, slug),
          ),
        );
      for (const document of documents) {
        for (const reference of npCollectContentTransferMediaReferences(
          config.fields,
          document,
          `collections.${slug}.${String(document.id)}`,
        )) {
          referencedMediaIds.add(reference.mediaId);
        }
      }
      collections[slug] = documents as NpContentTransferCollections[string];
    }

    const media: NpContentTransferMediaItem[] = [];
    const mediaIds = [...referencedMediaIds].sort(npCompareContentTransferText);
    for (let index = 0; index < mediaIds.length; index += MEDIA_QUERY_CHUNK) {
      const chunk = mediaIds.slice(index, index + MEDIA_QUERY_CHUNK);
      media.push(
        ...(await db
          .select({
            id: npMedia.id,
            filename: npMedia.filename,
            hash: npMedia.hash,
            mimeType: npMedia.mimeType,
          })
          .from(npMedia)
          .where(and(inArray(npMedia.id, chunk), isNull(npMedia.deletedAt)))
          .orderBy(asc(npMedia.id))),
      );
    }
    const foundMediaIds = new Set(media.map((item) => item.id));
    const missingMediaIds = mediaIds.filter((id) => !foundMediaIds.has(id));
    if (missingMediaIds.length > 0) {
      throw npContentTransferValidationError("Invalid collection media references", [
        {
          field: "media",
          message: `Referenced active media row(s) are missing: ${npSummarizeContentTransferValues(missingMediaIds)}`,
        },
      ]);
    }

    const plugins = (
      await Promise.all(
        pluginRows.map(async (row) => {
          const registration = getPluginRegistration(row.id);
          if (!registration) {
            throw new NpValidationError("Invalid stored plugin state", [
              {
                field: `plugins.${row.id}`,
                message: `Plugin '${row.id}' is installed in the database but is not loaded from nexpress.config.ts.`,
              },
            ]);
          }
          return {
            id: row.id,
            enabled: row.enabled,
            config: (await getPluginConfig(row.id)) ?? {},
            manifestVersion: registration.version ?? null,
          };
        }),
      )
    ).sort((left, right) => npCompareContentTransferText(left.id, right.id));

    const candidate = {
      version: NP_CONTENT_TRANSFER_VERSION,
      exportedAt: new Date().toISOString(),
      siteUrl: site.url,
      partial,
      collectionsExported: exportSlugs,
      collections,
      media,
      ...(partial
        ? {}
        : {
            site,
            theme: storedTheme ?? null,
            settings,
            navigation,
            plugins,
          }),
    };
    const transfer: NpContentTransferEnvelope = npRequireContentTransferRequestValue(() =>
      npRequireContentTransferEnvelope(candidate),
    );
    return npSuccessResponse(transfer);
  } catch (error) {
    const normalized =
      error instanceof NpValidationError
        ? npContentTransferValidationError(error.message, error.errors)
        : error;
    return npErrorResponse(normalized instanceof Error ? normalized : new Error("Unknown error"));
  }
}

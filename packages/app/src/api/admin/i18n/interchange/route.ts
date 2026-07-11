import {
  NpForbiddenError,
  NpValidationError,
  can,
  getCollectionConfig,
  getI18nConfig,
} from "@nexpress/core";
import { exportGettext, parseGettext } from "@nexpress/gettext";
import { applyTranslationCatalog, type NpTranslationCatalog } from "@nexpress/translation";
import { exportXliff, parseXliff } from "@nexpress/xliff";
import { type NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

type InterchangeFormat = "gettext" | "xliff";
type ImportMode = "preview" | "apply";

const MAX_ADMIN_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ADMIN_DOCUMENTS = 100;
const MAX_ADMIN_UNITS = 2_500;

export const dynamic = "force-dynamic";

/**
 * Download one bounded catalog for an i18n-enabled collection and locale pair.
 * Larger exports stay available through the project CLI, where request timeouts
 * and browser memory are not part of the execution envelope.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("i18n/interchange", "export");
    }

    const params = request.nextUrl.searchParams;
    const format = parseFormat(params.get("format"));
    const collection = requiredQuery(params.get("collection"), "collection");
    const sourceLocale = requiredQuery(params.get("sourceLocale"), "sourceLocale");
    const targetLocale = requiredQuery(params.get("targetLocale"), "targetLocale");
    assertSelection(collection, sourceLocale, targetLocale);

    const bundle =
      format === "xliff"
        ? await exportXliff({
            collections: [collection],
            sourceLocale,
            targetLocales: [targetLocale],
            user,
          })
        : await exportGettext({
            collections: [collection],
            sourceLocale,
            targetLocales: [targetLocale],
            user,
          });
    const file = bundle.files[0];
    if (!file) {
      throw validation(
        "collection",
        `No published translatable content was found in "${collection}" for ${sourceLocale}.`,
      );
    }
    assertAdminBounds(bundle.summary.docCount, file.unitCount);

    const body = "xml" in file ? file.xml : file.po;
    assertFileBytes(new TextEncoder().encode(body).byteLength);
    const filename = safeFilename(file.name);
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Type":
          format === "xliff"
            ? "application/xliff+xml; charset=utf-8"
            : "text/x-gettext-translation; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Np-Translation-Documents": String(bundle.summary.docCount),
        "X-Np-Translation-Units": String(file.unitCount),
      },
    });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

/** Preview or apply one uploaded XLIFF/PO catalog. Apply reparses the upload and
 * repeats every live-source check; a previous preview is never treated as an
 * authorization token or stale execution plan. */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("i18n/interchange", "import");
    }

    const formData = await request.formData();
    const mode = parseMode(formData.get("mode"));
    const format = parseFormat(formData.get("format"));
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw validation("file", "An XLIFF or Gettext PO file is required.");
    }
    if (file.size === 0) throw validation("file", "The translation file is empty.");
    assertFileBytes(file.size);
    if (file.name.length > 255) {
      throw validation("file", "Translation filename must be 255 characters or fewer.");
    }

    const content = await file.text();
    const catalog = parseCatalog(format, content);
    const summary = summarizeCatalog(catalog);
    assertAdminBounds(summary.documentCount, summary.unitCount);

    if (mode === "apply") await ensureFor("write");
    const result = await applyTranslationCatalog({
      catalog,
      user,
      dryRun: mode === "preview",
    });

    return npSuccessResponse(
      {
        mode,
        format,
        sourceName: file.name || `translation.${format === "xliff" ? "xliff" : "po"}`,
        sourceSize: file.size,
        catalog: summary,
        result,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

function parseCatalog(format: InterchangeFormat, content: string): NpTranslationCatalog {
  try {
    if (format === "gettext") return parseGettext(content);
    const parsed = parseXliff(content);
    return {
      documents: parsed.files.map((file) => ({
        route: file.original,
        sourceLocale: file.sourceLocale,
        targetLocale: file.targetLocale,
        units: file.units,
      })),
    };
  } catch (error) {
    throw validation(
      "file",
      `Unable to parse ${format === "xliff" ? "XLIFF" : "Gettext PO"}: ${(error as Error).message}`,
    );
  }
}

function summarizeCatalog(catalog: NpTranslationCatalog): {
  documentCount: number;
  unitCount: number;
  sourceLocale: string;
  targetLocale: string;
} {
  if (catalog.documents.length === 0) {
    throw validation("file", "Translation catalog contains no documents.");
  }
  const localePairs = new Map<string, { sourceLocale: string; targetLocale: string }>();
  let unitCount = 0;
  for (const document of catalog.documents) {
    const key = JSON.stringify([document.sourceLocale, document.targetLocale]);
    localePairs.set(key, {
      sourceLocale: document.sourceLocale,
      targetLocale: document.targetLocale,
    });
    unitCount += document.units.length;
  }
  if (localePairs.size !== 1) {
    throw validation("file", "Admin imports accept exactly one source/target locale pair.");
  }
  const pair = [...localePairs.values()][0];
  if (!pair || pair.sourceLocale === pair.targetLocale) {
    throw validation("file", "Translation source and target locales must differ.");
  }
  return {
    documentCount: catalog.documents.length,
    unitCount,
    sourceLocale: pair.sourceLocale,
    targetLocale: pair.targetLocale,
  };
}

function assertSelection(collection: string, sourceLocale: string, targetLocale: string): void {
  const i18n = getI18nConfig();
  if (!i18n) throw validation("i18n", "i18n is not configured for this project.");
  if (!i18n.locales.includes(sourceLocale)) {
    throw validation("sourceLocale", `Source locale "${sourceLocale}" is not configured.`);
  }
  if (!i18n.locales.includes(targetLocale)) {
    throw validation("targetLocale", `Target locale "${targetLocale}" is not configured.`);
  }
  if (sourceLocale === targetLocale) {
    throw validation("targetLocale", "Source and target locales must differ.");
  }
  try {
    if (!getCollectionConfig(collection).i18n) {
      throw validation("collection", `Collection "${collection}" is not i18n-enabled.`);
    }
  } catch (error) {
    if (error instanceof NpValidationError) throw error;
    throw validation("collection", `Unknown collection "${collection}".`);
  }
}

function assertAdminBounds(documentCount: number, unitCount: number): void {
  if (documentCount > MAX_ADMIN_DOCUMENTS) {
    throw validation(
      "file",
      `Catalog contains ${documentCount} documents; Admin supports at most ${MAX_ADMIN_DOCUMENTS}. Use the CLI for larger catalogs.`,
    );
  }
  if (unitCount > MAX_ADMIN_UNITS) {
    throw validation(
      "file",
      `Catalog contains ${unitCount} units; Admin supports at most ${MAX_ADMIN_UNITS}. Use the CLI for larger catalogs.`,
    );
  }
}

function assertFileBytes(bytes: number): void {
  if (bytes > MAX_ADMIN_FILE_BYTES) {
    throw validation(
      "file",
      `File exceeds the Admin limit of ${MAX_ADMIN_FILE_BYTES} bytes. Use the CLI for larger catalogs.`,
    );
  }
}

function parseFormat(value: FormDataEntryValue | string | null): InterchangeFormat {
  if (value === "xliff" || value === "gettext") return value;
  throw validation("format", 'format must be either "xliff" or "gettext".');
}

function parseMode(value: FormDataEntryValue | null): ImportMode {
  if (value === "preview" || value === "apply") return value;
  throw validation("mode", 'mode must be either "preview" or "apply".');
}

function requiredQuery(value: string | null, field: string): string {
  if (value && value.length <= 128) return value;
  throw validation(field, `${field} is required and must be at most 128 characters.`);
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 180) || "translations";
}

function validation(field: string, message: string): NpValidationError {
  return new NpValidationError("Invalid input", [{ field, message }]);
}

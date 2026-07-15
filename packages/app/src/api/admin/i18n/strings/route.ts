import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  deleteStringOverride,
  getAllStrings,
  getCurrentSiteId,
  getI18nConfig,
  listStringOverridesForSite,
  setStringOverride,
  can,
} from "@nexpress/core";
import {
  NpI18nContractError,
  npRequireI18nStringsResponse,
  npRequireStringOverrideDeleteQuery,
  npRequireStringOverrideMutation,
} from "@nexpress/core/i18n-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

/**
 * Phase D — UI string overrides admin surface.
 *
 *   GET /api/admin/i18n/strings
 *     → {
 *         locales: [...],
 *         defaultLocale: "...",
 *         keys: [
 *           {
 *             key: "magazine.tagline",
 *             values: { en: { base: "...", override: "..." | null }, ko: { ... } },
 *           },
 *           ...
 *         ],
 *       }
 *
 *     Returns the union of every key registered by plugins /
 *     themes (the base bundles), annotated with any override
 *     row for the current site. Overrides are scoped per
 *     site via getCurrentSiteId().
 *
 *   PUT /api/admin/i18n/strings
 *     body: { locale: string, key: string, value: string | null }
 *
 *     Sets the override. `value: null` marks the row as
 *     explicitly cleared (preserves audit trail). To delete
 *     the row entirely (no audit marker), use DELETE below.
 *
 *   DELETE /api/admin/i18n/strings?locale=ko&key=magazine.tagline
 *
 *     Drops the override row entirely.
 *
 * Editor-or-above can read; admin-only can write.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NpForbiddenError("i18n/strings", "list");
    }

    const i18n = getI18nConfig();
    const locales = i18n?.locales ?? ["en"];
    const defaultLocale = i18n?.defaultLocale ?? "en";
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

    const allStrings = getAllStrings();
    const overrides = await listStringOverridesForSite(siteId);

    // Index overrides by (locale, key) for O(1) lookup while
    // building the response.
    const overrideMap = new Map<string, string | null>();
    for (const row of overrides) {
      overrideMap.set(`${row.locale}::${row.key}`, row.value);
    }

    // Collect every key across every locale into a union; the
    // UI shows them as a single list with per-locale columns.
    const keySet = new Set<string>();
    for (const locale of locales) {
      const bundle = allStrings[locale] ?? {};
      for (const k of Object.keys(bundle)) keySet.add(k);
    }
    // Also include keys that have an override but no base
    // (so an admin can revert them).
    for (const row of overrides) keySet.add(row.key);

    const localeList = [...locales];
    const keys = [...keySet].sort().map((key) => {
      const values: Record<string, { base: string | null; override: string | null }> = {};
      for (const locale of localeList) {
        const base = allStrings[locale]?.[key] ?? null;
        const overrideKey = `${locale}::${key}`;
        const override = overrideMap.has(overrideKey)
          ? (overrideMap.get(overrideKey) ?? null)
          : null;
        values[locale] = { base, override };
      }
      return { key, values };
    });

    return npSuccessResponse(
      npRequireI18nStringsResponse({
        locales: localeList,
        defaultLocale,
        keys,
        siteId,
      }),
    );
  } catch (error) {
    return npErrorResponse(normalizeI18nError(error));
  }
}

/**
 * #339 — reject locale values that aren't in the configured
 * `i18n.locales` list. Without this gate an admin typo would
 * persist a row that no template lookup ever consults
 * (`allStrings[locale]` silently misses unrecognized keys), and
 * `np_string_overrides` accumulates orphaned rows the next
 * operator can't tell apart from intentional overrides.
 *
 * When the site has no `i18n` block configured, only the
 * implicit default locale (`"en"`) is allowed — same shape the
 * read path uses on line 80.
 */
function assertConfiguredLocale(locale: string): void {
  const i18n = getI18nConfig();
  const configured = i18n?.locales ?? ["en"];
  if (!configured.includes(locale)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "locale",
        message: `Locale "${locale}" is not configured. Allowed: ${configured.join(", ")}.`,
      },
    ]);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("i18n/strings", "update");
    }

    const { locale, key, value } = npRequireStringOverrideMutation(await readJsonBody(request));
    assertConfiguredLocale(locale);
    const registered = getAllStrings();
    if (!Object.values(registered).some((bundle) => Object.hasOwn(bundle, key))) {
      throw new NpValidationError("Invalid input", [
        { field: "key", message: `Translation key "${key}" is not registered.` },
      ]);
    }

    await setStringOverride(locale, key, value, { updatedBy: user.id });
    return npSuccessResponse({ locale, key, value });
  } catch (error) {
    return npErrorResponse(normalizeI18nError(error));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("i18n/strings", "delete");
    }

    const params = request.nextUrl.searchParams;
    const allowed = new Set(["locale", "key"]);
    for (const key of new Set(params.keys())) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) {
        throw new NpValidationError("Invalid input", [
          { field: `query.${key}`, message: "Unsupported or duplicate query parameter." },
        ]);
      }
    }
    const query = npRequireStringOverrideDeleteQuery({
      locale: params.get("locale"),
      key: params.get("key"),
    });
    if (params.size !== 2) {
      throw new NpValidationError("Invalid input", [
        { field: "query", message: "locale + key query params are required" },
      ]);
    }
    assertConfiguredLocale(query.locale);
    await deleteStringOverride(query.locale, query.key);
    return npSuccessResponse({ ok: true });
  } catch (error) {
    return npErrorResponse(normalizeI18nError(error));
  }
}

export const dynamic = "force-dynamic";

function normalizeI18nError(error: unknown): Error {
  if (error instanceof NpI18nContractError) {
    return new NpValidationError(
      "Invalid i18n input",
      error.issues.map((entry) => ({ field: entry.path, message: entry.message })),
    );
  }
  return error instanceof Error ? error : new Error("Unknown error");
}

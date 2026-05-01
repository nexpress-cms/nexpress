import {
  NX_DEFAULT_SITE_ID,
  NxForbiddenError,
  NxValidationError,
  deleteStringOverride,
  getAllStrings,
  getCurrentSiteId,
  getI18nConfig,
  listStringOverridesForSite,
  setStringOverride,
  can,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

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
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "content.publish")) {
      throw new NxForbiddenError("i18n/strings", "list");
    }

    const i18n = getI18nConfig();
    const locales = i18n?.locales ?? [];
    const defaultLocale = i18n?.defaultLocale ?? null;
    const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;

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
    for (const locale of locales.length > 0 ? locales : Object.keys(allStrings)) {
      const bundle = allStrings[locale] ?? {};
      for (const k of Object.keys(bundle)) keySet.add(k);
    }
    // Also include keys that have an override but no base
    // (so an admin can revert them).
    for (const row of overrides) keySet.add(row.key);

    const localeList = locales.length > 0 ? [...locales] : Object.keys(allStrings);
    const keys = [...keySet].sort().map((key) => {
      const values: Record<
        string,
        { base: string | null; override: string | null }
      > = {};
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

    return nxSuccessResponse({
      locales: localeList,
      defaultLocale,
      keys,
      siteId,
    });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("i18n/strings", "update");
    }

    const body = (await readJsonBody(request)) as {
      locale?: unknown;
      key?: unknown;
      value?: unknown;
    };
    const locale = typeof body.locale === "string" ? body.locale : null;
    const key = typeof body.key === "string" ? body.key : null;
    if (!locale || !key) {
      throw new NxValidationError("Invalid input", [
        { field: "body", message: "locale + key are required" },
      ]);
    }
    const value =
      typeof body.value === "string"
        ? body.value
        : body.value === null
          ? null
          : undefined;
    if (value === undefined) {
      throw new NxValidationError("Invalid input", [
        { field: "value", message: "value must be string or null" },
      ]);
    }

    await setStringOverride(locale, key, value, { updatedBy: user.id });
    return nxSuccessResponse({ locale, key, value });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NxForbiddenError("i18n/strings", "delete");
    }

    const params = request.nextUrl.searchParams;
    const locale = params.get("locale");
    const key = params.get("key");
    if (!locale || !key) {
      throw new NxValidationError("Invalid input", [
        { field: "query", message: "locale + key query params are required" },
      ]);
    }
    await deleteStringOverride(locale, key);
    return nxSuccessResponse({ ok: true });
  } catch (error) {
    return nxErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";

import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { getSiteById, NP_DEFAULT_SITE_ID, updateSite } from "../sites/registry.js";
import {
  DEFAULT_SEO_SETTINGS,
  npAnalyzeSeoSettings,
  npNormalizeSeoSettings,
  npNormalizeSiteGeneralSettings,
} from "./contract.js";
import type { NpAdminSettingsSnapshot, NpSeoSettings, NpSiteGeneralSettings } from "./types.js";

async function resolveSiteId(siteId?: string): Promise<string> {
  return siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
}

export async function getSiteGeneralSettings(siteId?: string): Promise<NpSiteGeneralSettings> {
  const resolved = await resolveSiteId(siteId);
  const site = await getSiteById(resolved);
  if (!site) throw new NpNotFoundError("site", resolved);
  return npNormalizeSiteGeneralSettings({
    name: site.name,
    url: site.settings.siteUrl,
    description: site.description,
    defaultLocale: site.settings.defaultLocale,
    timezone: site.settings.timezone,
  });
}

export async function setSiteGeneralSettings(
  value: unknown,
  siteId?: string,
): Promise<NpSiteGeneralSettings> {
  let normalized: NpSiteGeneralSettings;
  try {
    normalized = npNormalizeSiteGeneralSettings(value);
  } catch (error) {
    throw new NpValidationError("Invalid site settings", [
      { field: "site", message: error instanceof Error ? error.message : "Invalid site settings" },
    ]);
  }
  const resolved = await resolveSiteId(siteId);
  await updateSite(resolved, {
    name: normalized.name,
    description: normalized.description,
    settings: {
      siteUrl: normalized.url,
      defaultLocale: normalized.defaultLocale,
      timezone: normalized.timezone,
    },
  });
  return normalized;
}

export async function getSeoSettings(siteId?: string): Promise<NpSeoSettings> {
  const resolved = await resolveSiteId(siteId);
  const db = getDb();
  const [row] = await db
    .select({ value: npSettings.value })
    .from(npSettings)
    .where(and(eq(npSettings.siteId, resolved), eq(npSettings.key, "seo")))
    .limit(1);
  if (!row) return { ...DEFAULT_SEO_SETTINGS };
  const issue = npAnalyzeSeoSettings(row.value)[0];
  if (issue) {
    throw new NpValidationError("Invalid persisted SEO settings", [
      {
        field: issue.path,
        message: issue.message,
      },
    ]);
  }
  return row.value as NpSeoSettings;
}

export async function setSeoSettings(
  value: unknown,
  updatedBy: string | null,
  siteId?: string,
): Promise<NpSeoSettings> {
  let normalized: NpSeoSettings;
  try {
    normalized = npNormalizeSeoSettings(value);
  } catch (error) {
    throw new NpValidationError("Invalid SEO settings", [
      { field: "seo", message: error instanceof Error ? error.message : "Invalid SEO settings" },
    ]);
  }
  const resolved = await resolveSiteId(siteId);
  const db = getDb();
  const updatedAt = new Date();
  await db
    .insert(npSettings)
    .values({ siteId: resolved, key: "seo", value: normalized, updatedAt, updatedBy })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: { value: normalized, updatedAt, updatedBy },
    });
  return normalized;
}

export async function getAdminSettingsSnapshot(siteId?: string): Promise<NpAdminSettingsSnapshot> {
  const resolved = await resolveSiteId(siteId);
  const [site, seo] = await Promise.all([
    getSiteGeneralSettings(resolved),
    getSeoSettings(resolved),
  ]);
  return { site, seo };
}

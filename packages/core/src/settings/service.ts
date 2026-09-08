import {
  npAssertAgentPreviewEffectsAllowed,
  npAgentPreviewReadTransaction,
  npGetAgentChangeSetPreviewContext,
  npAgentPreviewSettingOverride,
} from "../agent/changeset-preview-overlay.js";
import type { NpTransaction } from "../collections/pipeline.js";
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { NpNotFoundError, NpValidationError, NpForbiddenError } from "../errors.js";
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
  const resolved = siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const scope = npGetAgentChangeSetPreviewContext();
  if (scope && scope.siteId !== resolved) throw new NpForbiddenError("preview", "cross-site");
  return resolved;
}

async function requireSettingsSite(
  siteId: string,
  options?: { tx?: NpTransaction },
): Promise<void> {
  if (!(await getSiteById(siteId, { tx: await npAgentPreviewReadTransaction(options?.tx) })))
    throw new NpNotFoundError("site", siteId);
}

export async function getSiteGeneralSettings(siteId?: string): Promise<NpSiteGeneralSettings> {
  const resolved = await resolveSiteId(siteId);
  const tx = await npAgentPreviewReadTransaction();
  const site = await getSiteById(resolved, { tx });
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
  npAssertAgentPreviewEffectsAllowed();
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

export async function getSeoSettings(
  siteId?: string,
  options?: { tx?: NpTransaction },
): Promise<NpSeoSettings> {
  const resolved = await resolveSiteId(siteId);
  if (
    npGetAgentChangeSetPreviewContext() &&
    resolved !== npGetAgentChangeSetPreviewContext()?.siteId
  )
    throw new NpForbiddenError("preview", "cross-site");
  await requireSettingsSite(resolved, options);
  const db = ((await npAgentPreviewReadTransaction(options?.tx)) ?? getDb()) as ReturnType<
    typeof getDb
  >;
  const [row] = await db
    .select({ value: npSettings.value })
    .from(npSettings)
    .where(and(eq(npSettings.siteId, resolved), eq(npSettings.key, "seo")))
    .limit(1);
  const preview = npAgentPreviewSettingOverride("seo");
  const value = preview ? preview.value : row?.value;
  if (value === null || value === undefined) return { ...DEFAULT_SEO_SETTINGS };
  const issue = npAnalyzeSeoSettings(value)[0];
  if (issue) {
    throw new NpValidationError("Invalid persisted SEO settings", [
      {
        field: issue.path,
        message: issue.message,
      },
    ]);
  }
  return value as NpSeoSettings;
}

export async function setSeoSettings(
  value: unknown,
  updatedBy: string | null,
  siteId?: string,
  options?: { tx?: NpTransaction },
): Promise<NpSeoSettings> {
  npAssertAgentPreviewEffectsAllowed();
  let normalized: NpSeoSettings;
  try {
    normalized = npNormalizeSeoSettings(value);
  } catch (error) {
    throw new NpValidationError("Invalid SEO settings", [
      { field: "seo", message: error instanceof Error ? error.message : "Invalid SEO settings" },
    ]);
  }
  const resolved = await resolveSiteId(siteId);
  await requireSettingsSite(resolved, options);
  const db = ((await npAgentPreviewReadTransaction(options?.tx)) ?? getDb()) as ReturnType<
    typeof getDb
  >;
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

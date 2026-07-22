import type {
  NpAdminSettingsSnapshot,
  NpCreateSiteInput,
  NpSeoSettings,
  NpSettingContractIssue,
  NpSettingContractKind,
  NpSettingValidationResult,
  NpSiteGeneralSettings,
  NpSiteMembershipGrantInput,
  NpSiteMembershipRecord,
  NpSiteMembershipWireRecord,
  NpSiteRecord,
  NpSiteRuntimeSettings,
  NpSiteSummaryWireRecord,
  NpSiteUsage,
  NpSiteWireRecord,
  NpUpdateSiteInput,
} from "./types.js";
import {
  npIsUserRole as npIsAuthUserRole,
  npUserRoles,
  type NpUserRole,
} from "../auth-contract/index.js";
import { npAnalyzeThemeTokensOverlay } from "../theme/contract.js";
import { npValidateBlockContent } from "../fields/block-content.js";
import { npAnalyzeJobsPauseState } from "../jobs-contract/contract.js";
import { NP_DEFAULT_SITE_ID, npIsCanonicalSiteId } from "../sites/id-contract.js";

export { NP_DEFAULT_SITE_ID, npIsCanonicalSiteId, npSiteIdPattern } from "../sites/id-contract.js";

export { npUserRoles };
export const npUserIdPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

export const npSettingsContractLimits = {
  siteIdLength: 63,
  siteNameLength: 160,
  hostnameLength: 253,
  descriptionLength: 4096,
  settingKeyLength: 160,
  jsonStringLength: 1_000_000,
  timezoneLength: 100,
  urlLength: 2048,
  localeLength: 35,
} as const;

export const npDynamicSettingOwnerPattern = "^[a-z][a-z0-9-]{0,62}$";
export const npPluginIdPattern = "^(?:@[A-Za-z0-9_-]+/)?[A-Za-z0-9_-]+$";
export const npPluginIdMaxLength = 128;
/** Alias naming the plugin-id rule in its dynamic setting-owner role. */
export const npPluginSettingOwnerPattern = npPluginIdPattern;

export const DEFAULT_SITE_RUNTIME_SETTINGS: NpSiteRuntimeSettings = {
  siteUrl: null,
  defaultLocale: null,
  timezone: null,
};

export const DEFAULT_SEO_SETTINGS: NpSeoSettings = {
  defaultOgImage: null,
  twitterHandle: null,
  defaultLocale: "en_US",
};

const ownerPattern = new RegExp(npDynamicSettingOwnerPattern, "u");
const pluginOwnerPattern = new RegExp(npPluginIdPattern, "u");
const hostnamePattern =
  /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*)$/u;
const siteSettingsKeys = new Set(["siteUrl", "defaultLocale", "timezone"]);
const siteRecordKeys = new Set([
  "id",
  "name",
  "hostname",
  "description",
  "settings",
  "isDefault",
  "createdAt",
  "updatedAt",
]);
const createSiteKeys = new Set(["id", "name", "hostname", "description", "settings"]);
const updateSiteKeys = new Set(["name", "hostname", "description", "settings"]);
const siteSummaryKeys = new Set(["id", "name", "hostname", "isDefault"]);
const membershipKeys = new Set(["siteId", "userId", "role", "createdAt", "updatedAt"]);
const membershipGrantKeys = new Set(["userId", "role"]);
const siteUsageKeys = new Set([
  "collections",
  "settings",
  "navigation",
  "slugHistory",
  "memberships",
  "stringOverrides",
  "pluginStorage",
  "media",
  "mediaFolders",
  "mediaRefs",
  "comments",
  "contentViews",
  "reactions",
  "follows",
  "mutes",
  "notifications",
  "reports",
  "auditEvents",
  "bans",
  "memberRoles",
  "total",
]);
const generalKeys = new Set(["name", "url", "description", "defaultLocale", "timezone"]);
const seoKeys = new Set(["defaultOgImage", "twitterHandle", "defaultLocale"]);
const snapshotKeys = new Set(["site", "seo"]);
const userIdPattern = new RegExp(npUserIdPattern, "u");

function issue(
  code: NpSettingContractIssue["code"],
  path: string,
  message: string,
): NpSettingContractIssue {
  return { code, path, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function pushUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpSettingContractIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported field "${key}".`));
    }
  }
}

function hasUnsafeControl(value: string, multiline = false): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    if (multiline && (code === 0x09 || code === 0x0a || code === 0x0d)) return false;
    return code <= 0x1f || code === 0x7f;
  });
}

function isBoundedText(value: unknown, max: number, multiline = false): value is string {
  return typeof value === "string" && value.length <= max && !hasUnsafeControl(value, multiline);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function canonicalHttpOrigin(value: string): string | null {
  if (value.length === 0 || value.length > npSettingsContractLimits.urlLength) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function canonicalLocale(value: string): string | null {
  if (value.length === 0 || value.length > npSettingsContractLimits.localeLength) return null;
  try {
    return Intl.getCanonicalLocales(value.replaceAll("_", "-"))[0] ?? null;
  } catch {
    return null;
  }
}

function canonicalTimezone(value: string): string | null {
  if (value.length === 0 || value.length > npSettingsContractLimits.timezoneLength) return null;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function normalizeHostname(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("hostname must be host text or null.");
  const candidate = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    candidate.length === 0 ||
    candidate.length > npSettingsContractLimits.hostnameLength ||
    !hostnamePattern.test(candidate)
  ) {
    throw new Error("hostname must be canonical DNS host text, localhost, or null.");
  }
  return candidate;
}

export function npNormalizeSiteHostname(value: unknown): string | null {
  return normalizeHostname(value);
}

export function npNormalizeSiteHostHeader(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("host header must be non-empty text.");
  }
  const candidate = value.trim();
  if (
    candidate.includes("://") ||
    candidate.includes("/") ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    candidate.includes("@")
  ) {
    throw new Error("host header must contain only a hostname and optional port.");
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${candidate}`).hostname;
  } catch {
    throw new Error("host header must contain a valid hostname and optional port.");
  }
  const normalized = normalizeHostname(hostname);
  if (!normalized) throw new Error("host header must contain a hostname.");
  return normalized;
}

export function npIsUserRole(value: unknown): value is NpUserRole {
  return npIsAuthUserRole(value);
}

export function npIsCanonicalUserId(value: unknown): value is string {
  return typeof value === "string" && userIdPattern.test(value);
}

export function npNormalizeSiteRuntimeSettings(value: unknown): NpSiteRuntimeSettings {
  if (!isPlainRecord(value)) {
    throw new Error("site settings must be a plain object.");
  }
  const unknown = Object.keys(value).find((key) => !siteSettingsKeys.has(key));
  if (unknown) throw new Error(`unsupported site settings field "${unknown}".`);

  const siteUrl = value.siteUrl;
  const defaultLocale = value.defaultLocale;
  const timezone = value.timezone;
  if (siteUrl !== null && typeof siteUrl !== "string") {
    throw new Error("siteUrl must be an absolute HTTP(S) origin or null.");
  }
  const canonicalUrl = siteUrl === null ? null : canonicalHttpOrigin(siteUrl);
  if (siteUrl !== null && canonicalUrl === null) {
    throw new Error(
      "siteUrl must be an absolute HTTP(S) origin without a path, query, or credentials.",
    );
  }
  if (defaultLocale !== null && typeof defaultLocale !== "string") {
    throw new Error("defaultLocale must be a canonical locale or null.");
  }
  const locale = defaultLocale === null ? null : canonicalLocale(defaultLocale);
  if (defaultLocale !== null && locale === null) {
    throw new Error("defaultLocale must be a canonical BCP 47 locale.");
  }
  if (timezone !== null && typeof timezone !== "string") {
    throw new Error("timezone must be a canonical IANA time zone or null.");
  }
  const canonicalZone = timezone === null ? null : canonicalTimezone(timezone);
  if (timezone !== null && canonicalZone === null) {
    throw new Error("timezone must be a canonical IANA time zone or null.");
  }
  return { siteUrl: canonicalUrl, defaultLocale: locale, timezone: canonicalZone };
}

export function npAnalyzeSiteRuntimeSettings(value: unknown): NpSettingContractIssue[] {
  try {
    const normalized = npNormalizeSiteRuntimeSettings(value);
    const raw = value as Record<string, unknown>;
    if (
      raw.siteUrl !== normalized.siteUrl ||
      raw.defaultLocale !== normalized.defaultLocale ||
      raw.timezone !== normalized.timezone
    ) {
      return [
        issue(
          "invalid-field",
          "site.settings",
          "site settings must already use canonical URL, locale, and timezone values.",
        ),
      ];
    }
    return [];
  } catch (error) {
    return [
      issue(
        isPlainRecord(value) ? "invalid-field" : "shape",
        "site.settings",
        error instanceof Error ? error.message : "invalid site settings.",
      ),
    ];
  }
}

export function isNpSiteRuntimeSettings(value: unknown): value is NpSiteRuntimeSettings {
  return npAnalyzeSiteRuntimeSettings(value).length === 0;
}

export function npNormalizeSiteGeneralSettings(value: unknown): NpSiteGeneralSettings {
  if (!isPlainRecord(value)) throw new Error("general settings must be a plain object.");
  const unknown = Object.keys(value).find((key) => !generalKeys.has(key));
  if (unknown) throw new Error(`unsupported general settings field "${unknown}".`);
  if (
    typeof value.name !== "string" ||
    value.name !== value.name.trim() ||
    value.name.length === 0 ||
    value.name.length > npSettingsContractLimits.siteNameLength ||
    hasUnsafeControl(value.name)
  ) {
    throw new Error("name must be non-empty trimmed text.");
  }
  if (
    value.description !== null &&
    !isBoundedText(value.description, npSettingsContractLimits.descriptionLength, true)
  ) {
    throw new Error("description must be bounded text or null.");
  }
  const settings = npNormalizeSiteRuntimeSettings({
    siteUrl: value.url,
    defaultLocale: value.defaultLocale,
    timezone: value.timezone,
  });
  return {
    name: value.name,
    url: settings.siteUrl,
    description: value.description,
    defaultLocale: settings.defaultLocale,
    timezone: settings.timezone,
  };
}

export function npAnalyzeSiteGeneralSettings(value: unknown): NpSettingContractIssue[] {
  try {
    const normalized = npNormalizeSiteGeneralSettings(value);
    const raw = value as Record<string, unknown>;
    if (
      raw.name !== normalized.name ||
      raw.url !== normalized.url ||
      raw.description !== normalized.description ||
      raw.defaultLocale !== normalized.defaultLocale ||
      raw.timezone !== normalized.timezone
    ) {
      return [
        issue(
          "invalid-field",
          "settings.site",
          "site identity must already use canonical URL, locale, and timezone values.",
        ),
      ];
    }
    return [];
  } catch (error) {
    return [
      issue(
        isPlainRecord(value) ? "invalid-field" : "shape",
        "settings.site",
        error instanceof Error ? error.message : "invalid site settings.",
      ),
    ];
  }
}

export function npNormalizeCreateSiteInput(value: unknown): NpCreateSiteInput {
  if (!isPlainRecord(value)) throw new Error("site input must be a plain object.");
  const unknown = Object.keys(value).find((key) => !createSiteKeys.has(key));
  if (unknown) throw new Error(`unsupported site field "${unknown}".`);
  if (!npIsCanonicalSiteId(value.id)) {
    throw new Error("id must be a canonical lowercase site id.");
  }
  if (value.id === NP_DEFAULT_SITE_ID) {
    throw new Error(`id "${NP_DEFAULT_SITE_ID}" is reserved for the framework default site.`);
  }
  const settings = npNormalizeSiteRuntimeSettings(
    "settings" in value ? value.settings : DEFAULT_SITE_RUNTIME_SETTINGS,
  );
  const general = npNormalizeSiteGeneralSettings({
    name: value.name,
    url: settings.siteUrl,
    description: "description" in value ? value.description : null,
    defaultLocale: settings.defaultLocale,
    timezone: settings.timezone,
  });
  const hostname = normalizeHostname("hostname" in value ? value.hostname : null);
  return {
    id: value.id,
    name: general.name,
    hostname,
    description: general.description,
    settings,
  };
}

export function npAnalyzeCreateSiteInput(value: unknown): NpSettingContractIssue[] {
  try {
    npNormalizeCreateSiteInput(value);
    return [];
  } catch (error) {
    return [
      issue(
        isPlainRecord(value) ? "invalid-field" : "shape",
        "site",
        error instanceof Error ? error.message : "invalid site input.",
      ),
    ];
  }
}

export function npNormalizeUpdateSiteInput(value: unknown): NpUpdateSiteInput {
  if (!isPlainRecord(value)) throw new Error("site patch must be a plain object.");
  const unknown = Object.keys(value).find((key) => !updateSiteKeys.has(key));
  if (unknown) throw new Error(`unsupported site patch field "${unknown}".`);
  if (Object.keys(value).length === 0)
    throw new Error("site patch must change at least one field.");

  const patch: NpUpdateSiteInput = {};
  if ("name" in value) {
    const general = npNormalizeSiteGeneralSettings({
      name: value.name,
      url: null,
      description: null,
      defaultLocale: null,
      timezone: null,
    });
    patch.name = general.name;
  }
  if ("hostname" in value) patch.hostname = normalizeHostname(value.hostname);
  if ("description" in value) {
    if (
      value.description !== null &&
      !isBoundedText(value.description, npSettingsContractLimits.descriptionLength, true)
    ) {
      throw new Error("description must be bounded text or null.");
    }
    patch.description = value.description;
  }
  if ("settings" in value) patch.settings = npNormalizeSiteRuntimeSettings(value.settings);
  return patch;
}

export function npAnalyzeUpdateSiteInput(value: unknown): NpSettingContractIssue[] {
  try {
    npNormalizeUpdateSiteInput(value);
    return [];
  } catch (error) {
    return [
      issue(
        isPlainRecord(value) ? "invalid-field" : "shape",
        "site",
        error instanceof Error ? error.message : "invalid site patch.",
      ),
    ];
  }
}

export function npNormalizeSiteMembershipGrantInput(value: unknown): NpSiteMembershipGrantInput {
  if (!isPlainRecord(value)) throw new Error("membership input must be a plain object.");
  const unknown = Object.keys(value).find((key) => !membershipGrantKeys.has(key));
  if (unknown) throw new Error(`unsupported membership field "${unknown}".`);
  if (!npIsCanonicalUserId(value.userId)) {
    throw new Error("userId must be a canonical UUID.");
  }
  if (!npIsUserRole(value.role)) {
    throw new Error(`role must be one of ${npUserRoles.join(", ")}.`);
  }
  return { userId: value.userId, role: value.role };
}

export function npAnalyzeSiteMembershipGrantInput(value: unknown): NpSettingContractIssue[] {
  try {
    npNormalizeSiteMembershipGrantInput(value);
    return [];
  } catch (error) {
    return [
      issue(
        isPlainRecord(value) ? "invalid-field" : "shape",
        "membership",
        error instanceof Error ? error.message : "invalid membership input.",
      ),
    ];
  }
}

export function npNormalizeSeoSettings(value: unknown): NpSeoSettings {
  if (!isPlainRecord(value)) throw new Error("SEO settings must be a plain object.");
  const unknown = Object.keys(value).find((key) => !seoKeys.has(key));
  if (unknown) throw new Error(`unsupported SEO settings field "${unknown}".`);

  let defaultOgImage: string | null = null;
  if (value.defaultOgImage !== null) {
    if (typeof value.defaultOgImage !== "string") {
      throw new Error("defaultOgImage must be an HTTP(S) URL, a /-rooted path, or null.");
    }
    const candidate = value.defaultOgImage.trim();
    if (candidate.length === 0 || candidate.length > npSettingsContractLimits.urlLength) {
      throw new Error("defaultOgImage must be bounded non-empty text or null.");
    }
    if (candidate.startsWith("/")) {
      if (candidate.startsWith("//") || hasUnsafeControl(candidate)) {
        throw new Error("defaultOgImage contains an unsafe path.");
      }
    } else {
      try {
        const url = new URL(candidate);
        if (
          (url.protocol !== "http:" && url.protocol !== "https:") ||
          url.username ||
          url.password
        ) {
          throw new Error();
        }
      } catch {
        throw new Error("defaultOgImage must be an HTTP(S) URL or a /-rooted path.");
      }
    }
    defaultOgImage = candidate;
  }

  let twitterHandle: string | null = null;
  if (value.twitterHandle !== null) {
    if (typeof value.twitterHandle !== "string") {
      throw new Error("twitterHandle must be text or null.");
    }
    const candidate = value.twitterHandle.trim().replace(/^@/u, "");
    if (!/^[A-Za-z0-9_]{1,15}$/u.test(candidate)) {
      throw new Error("twitterHandle must use 1-15 alphanumeric or underscore characters.");
    }
    twitterHandle = candidate;
  }

  if (typeof value.defaultLocale !== "string") {
    throw new Error("defaultLocale must be a locale string.");
  }
  const locale = canonicalLocale(value.defaultLocale);
  if (!locale) throw new Error("defaultLocale must be a canonical BCP 47 locale.");
  return {
    defaultOgImage,
    twitterHandle,
    defaultLocale: locale.replaceAll("-", "_"),
  };
}

export function npAnalyzeSeoSettings(value: unknown): NpSettingContractIssue[] {
  try {
    const normalized = npNormalizeSeoSettings(value);
    const raw = value as Record<string, unknown>;
    if (
      raw.defaultOgImage !== normalized.defaultOgImage ||
      raw.twitterHandle !== normalized.twitterHandle ||
      raw.defaultLocale !== normalized.defaultLocale
    ) {
      return [
        issue(
          "invalid-field",
          "settings.seo",
          "SEO settings must already use canonical URL, handle, and locale values.",
        ),
      ];
    }
    return [];
  } catch (error) {
    return [
      issue(
        isPlainRecord(value) ? "invalid-field" : "shape",
        "settings.seo",
        error instanceof Error ? error.message : "invalid SEO settings.",
      ),
    ];
  }
}

export function isNpSeoSettings(value: unknown): value is NpSeoSettings {
  return npAnalyzeSeoSettings(value).length === 0;
}

function analyzeSiteRecord(value: unknown, wire: boolean): NpSettingContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", "site", "site records must be plain objects.")];
  const issues: NpSettingContractIssue[] = [];
  pushUnknown(value, siteRecordKeys, "site", issues);
  issues.push(...npAnalyzeSiteRuntimeSettings(value.settings));
  if (!npIsCanonicalSiteId(value.id)) {
    issues.push(issue("invalid-field", "site.id", "site id must be a canonical lowercase id."));
  }
  try {
    npNormalizeSiteGeneralSettings({
      name: value.name,
      url: isPlainRecord(value.settings) ? value.settings.siteUrl : undefined,
      description: value.description,
      defaultLocale: isPlainRecord(value.settings) ? value.settings.defaultLocale : undefined,
      timezone: isPlainRecord(value.settings) ? value.settings.timezone : undefined,
    });
  } catch (error) {
    issues.push(
      issue("invalid-field", "site", error instanceof Error ? error.message : "invalid site."),
    );
  }
  if (
    value.hostname !== null &&
    (typeof value.hostname !== "string" ||
      value.hostname.length > npSettingsContractLimits.hostnameLength ||
      value.hostname !== value.hostname.toLowerCase() ||
      !hostnamePattern.test(value.hostname))
  ) {
    issues.push(
      issue(
        "invalid-field",
        "site.hostname",
        "hostname must be canonical lowercase host text or null.",
      ),
    );
  }
  if (typeof value.isDefault !== "boolean") {
    issues.push(issue("invalid-field", "site.isDefault", "isDefault must be boolean."));
  } else if (value.isDefault !== (value.id === NP_DEFAULT_SITE_ID)) {
    issues.push(
      issue(
        "invalid-field",
        "site.isDefault",
        `isDefault must be true only for the reserved "${NP_DEFAULT_SITE_ID}" site.`,
      ),
    );
  }
  for (const key of ["createdAt", "updatedAt"] as const) {
    const valid = wire
      ? isIsoDate(value[key])
      : value[key] instanceof Date && !Number.isNaN(value[key].valueOf());
    if (!valid)
      issues.push(
        issue(
          "invalid-field",
          `site.${key}`,
          `${key} must be a valid ${wire ? "ISO string" : "Date"}.`,
        ),
      );
  }
  return issues;
}

export function npAnalyzeSiteRecord(value: unknown): NpSettingContractIssue[] {
  return analyzeSiteRecord(value, false);
}

export function npAnalyzeSiteWireRecord(value: unknown): NpSettingContractIssue[] {
  return analyzeSiteRecord(value, true);
}

export function isNpSiteWireRecord(value: unknown): value is NpSiteWireRecord {
  return npAnalyzeSiteWireRecord(value).length === 0;
}

export function npAssertSiteRecord(value: unknown): asserts value is NpSiteRecord {
  const first = npAnalyzeSiteRecord(value)[0];
  if (first) throw new Error(`Invalid persisted site at ${first.path}: ${first.message}`);
}

export function npSerializeSiteRecord(value: NpSiteRecord): NpSiteWireRecord {
  npAssertSiteRecord(value);
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

export function npAnalyzeSiteSummaryWireRecord(value: unknown): NpSettingContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", "site", "site summaries must be plain objects.")];
  }
  const issues: NpSettingContractIssue[] = [];
  pushUnknown(value, siteSummaryKeys, "site", issues);
  if (!npIsCanonicalSiteId(value.id)) {
    issues.push(issue("invalid-field", "site.id", "site id must be canonical."));
  }
  if (
    typeof value.name !== "string" ||
    value.name !== value.name.trim() ||
    value.name.length === 0 ||
    value.name.length > npSettingsContractLimits.siteNameLength ||
    hasUnsafeControl(value.name)
  ) {
    issues.push(issue("invalid-field", "site.name", "site name must be bounded trimmed text."));
  }
  if (
    value.hostname !== null &&
    (typeof value.hostname !== "string" ||
      value.hostname.length > npSettingsContractLimits.hostnameLength ||
      value.hostname !== value.hostname.toLowerCase() ||
      !hostnamePattern.test(value.hostname))
  ) {
    issues.push(issue("invalid-field", "site.hostname", "hostname must be canonical or null."));
  }
  if (
    typeof value.isDefault !== "boolean" ||
    value.isDefault !== (value.id === NP_DEFAULT_SITE_ID)
  ) {
    issues.push(
      issue(
        "invalid-field",
        "site.isDefault",
        `isDefault must be true only for the reserved "${NP_DEFAULT_SITE_ID}" site.`,
      ),
    );
  }
  return issues;
}

export function isNpSiteSummaryWireRecord(value: unknown): value is NpSiteSummaryWireRecord {
  return npAnalyzeSiteSummaryWireRecord(value).length === 0;
}

export function npSerializeSiteSummary(value: NpSiteRecord): NpSiteSummaryWireRecord {
  npAssertSiteRecord(value);
  return {
    id: value.id,
    name: value.name,
    hostname: value.hostname,
    isDefault: value.isDefault,
  };
}

function analyzeSiteMembership(value: unknown, wire: boolean): NpSettingContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", "membership", "membership records must be plain objects.")];
  }
  const issues: NpSettingContractIssue[] = [];
  pushUnknown(value, membershipKeys, "membership", issues);
  if (!npIsCanonicalSiteId(value.siteId)) {
    issues.push(issue("invalid-field", "membership.siteId", "siteId must be canonical."));
  }
  if (!npIsCanonicalUserId(value.userId)) {
    issues.push(issue("invalid-field", "membership.userId", "userId must be a canonical UUID."));
  }
  if (!npIsUserRole(value.role)) {
    issues.push(
      issue("invalid-field", "membership.role", `role must be one of ${npUserRoles.join(", ")}.`),
    );
  }
  for (const key of ["createdAt", "updatedAt"] as const) {
    const valid = wire
      ? isIsoDate(value[key])
      : value[key] instanceof Date && !Number.isNaN(value[key].valueOf());
    if (!valid) {
      issues.push(
        issue(
          "invalid-field",
          `membership.${key}`,
          `${key} must be a valid ${wire ? "ISO string" : "Date"}.`,
        ),
      );
    }
  }
  return issues;
}

export function npAnalyzeSiteMembershipRecord(value: unknown): NpSettingContractIssue[] {
  return analyzeSiteMembership(value, false);
}

export function npAnalyzeSiteMembershipWireRecord(value: unknown): NpSettingContractIssue[] {
  return analyzeSiteMembership(value, true);
}

export function isNpSiteMembershipWireRecord(value: unknown): value is NpSiteMembershipWireRecord {
  return npAnalyzeSiteMembershipWireRecord(value).length === 0;
}

export function npAssertSiteMembershipRecord(
  value: unknown,
): asserts value is NpSiteMembershipRecord {
  const first = npAnalyzeSiteMembershipRecord(value)[0];
  if (first) {
    throw new Error(`Invalid persisted membership at ${first.path}: ${first.message}`);
  }
}

export function npSerializeSiteMembership(
  value: NpSiteMembershipRecord,
): NpSiteMembershipWireRecord {
  npAssertSiteMembershipRecord(value);
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

export function npAnalyzeSiteUsage(value: unknown): NpSettingContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", "siteUsage", "site usage must be a plain object.")];
  }
  const issues: NpSettingContractIssue[] = [];
  pushUnknown(value, siteUsageKeys, "siteUsage", issues);
  if (!isPlainRecord(value.collections)) {
    issues.push(
      issue("shape", "siteUsage.collections", "collections must be a plain count object."),
    );
  }
  const collectionCounts = isPlainRecord(value.collections)
    ? Object.entries(value.collections)
    : [];
  for (const [slug, count] of collectionCounts) {
    if (slug.length === 0 || slug.length > 160 || hasUnsafeControl(slug)) {
      issues.push(
        issue("invalid-field", `siteUsage.collections.${slug}`, "collection slug is invalid."),
      );
    }
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      issues.push(
        issue(
          "invalid-field",
          `siteUsage.collections.${slug}`,
          "collection count must be a non-negative safe integer.",
        ),
      );
    }
  }
  const countKeys = [...siteUsageKeys].filter((key) => key !== "collections" && key !== "total");
  for (const key of [...countKeys, "total"]) {
    const count = value[key];
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      issues.push(
        issue("invalid-field", `siteUsage.${key}`, `${key} must be a non-negative safe integer.`),
      );
    }
  }
  if (issues.length === 0) {
    const expected =
      collectionCounts.reduce((sum, [, count]) => sum + (count as number), 0) +
      countKeys.reduce((sum, key) => sum + (value[key] as number), 0);
    if (value.total !== expected) {
      issues.push(
        issue(
          "invalid-field",
          "siteUsage.total",
          `total must equal the exact count sum ${expected}.`,
        ),
      );
    }
  }
  return issues;
}

export function isNpSiteUsage(value: unknown): value is NpSiteUsage {
  return npAnalyzeSiteUsage(value).length === 0;
}

export function npAssertSiteUsage(value: unknown): asserts value is NpSiteUsage {
  const first = npAnalyzeSiteUsage(value)[0];
  if (first) throw new Error(`Invalid site usage at ${first.path}: ${first.message}`);
}

export function npAnalyzeAdminSettingsSnapshot(value: unknown): NpSettingContractIssue[] {
  if (!isPlainRecord(value))
    return [issue("shape", "settings", "settings snapshot must be a plain object.")];
  const issues: NpSettingContractIssue[] = [];
  pushUnknown(value, snapshotKeys, "settings", issues);
  issues.push(...npAnalyzeSiteGeneralSettings(value.site));
  issues.push(...npAnalyzeSeoSettings(value.seo));
  return issues;
}

export function isNpAdminSettingsSnapshot(value: unknown): value is NpAdminSettingsSnapshot {
  return npAnalyzeAdminSettingsSnapshot(value).length === 0;
}

export function npClassifySettingKey(key: unknown): NpSettingContractKind | null {
  if (key === "seo") return "seo";
  if (key === "theme") return "theme-tokens";
  if (key === "community") return "community";
  if (key === "activeTheme") return "active-theme";
  if (key === "page-builder.patterns") return "page-builder-patterns";
  if (key === "jobs.paused") return "jobs-pause";
  if (typeof key !== "string" || key.length > npSettingsContractLimits.settingKeyLength)
    return null;
  const dynamic = /^(theme\.settings|plugin\.config):(.+)$/u.exec(key);
  if (!dynamic) return null;
  const owner = dynamic[2] ?? "";
  if (dynamic[1] === "theme.settings") {
    return ownerPattern.test(owner) ? "theme-settings" : null;
  }
  return pluginOwnerPattern.test(owner) ? "plugin-config" : null;
}

export function npValidateSettingKey(key: unknown): NpSettingValidationResult {
  if (npClassifySettingKey(key)) return { ok: true };
  return {
    ok: false,
    issue: issue(
      "unknown-key",
      "settings.key",
      `unsupported settings key ${JSON.stringify(key)}; use a registered framework or owner namespace.`,
    ),
  };
}

function isJsonValue(value: unknown, depth = 0, state = { nodes: 0 }): boolean {
  state.nodes++;
  if (state.nodes > 10_000 || depth > 32) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") {
    return value.length <= npSettingsContractLimits.jsonStringLength;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1, state));
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).every(
    ([key, nested]) => key.length <= 160 && isJsonValue(nested, depth + 1, state),
  );
}

function analyzeVersionedEnvelope(value: unknown, path: string): NpSettingContractIssue[] {
  if (!isPlainRecord(value))
    return [issue("shape", path, "versioned settings must be a plain object.")];
  const issues: NpSettingContractIssue[] = [];
  pushUnknown(value, new Set(["__npVersion", "__npSettings"]), path, issues);
  if (
    typeof value.__npVersion !== "number" ||
    !Number.isSafeInteger(value.__npVersion) ||
    value.__npVersion < 1 ||
    value.__npVersion > 1_000_000
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.__npVersion`,
        "settings version must be a positive safe integer.",
      ),
    );
  }
  if (!("__npSettings" in value) || !isJsonValue(value.__npSettings)) {
    issues.push(
      issue("invalid-field", `${path}.__npSettings`, "settings payload must be bounded JSON."),
    );
  }
  return issues;
}

function analyzeCommunity(value: unknown): NpSettingContractIssue[] {
  const path = "settings.community";
  if (!isPlainRecord(value))
    return [issue("shape", path, "community settings must be a plain object.")];
  const issues: NpSettingContractIssue[] = [];
  pushUnknown(
    value,
    new Set(["reactionKinds", "registrationEnabled", "memberUploadQuota"]),
    path,
    issues,
  );
  if (
    !Array.isArray(value.reactionKinds) ||
    value.reactionKinds.length > 32 ||
    !value.reactionKinds.every(
      (entry) => typeof entry === "string" && /^[a-z][a-z0-9_-]{0,29}$/u.test(entry),
    ) ||
    new Set(value.reactionKinds as string[]).size !== value.reactionKinds.length
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.reactionKinds`,
        "reactionKinds must contain at most 32 unique canonical kinds.",
      ),
    );
  }
  if (typeof value.registrationEnabled !== "boolean") {
    issues.push(
      issue("invalid-field", `${path}.registrationEnabled`, "registrationEnabled must be boolean."),
    );
  }
  if (!isPlainRecord(value.memberUploadQuota)) {
    issues.push(
      issue("shape", `${path}.memberUploadQuota`, "memberUploadQuota must be a plain object."),
    );
  } else {
    pushUnknown(
      value.memberUploadQuota,
      new Set(["perDay", "total"]),
      `${path}.memberUploadQuota`,
      issues,
    );
    for (const key of ["perDay", "total"] as const) {
      const bound = value.memberUploadQuota[key];
      if (
        bound !== null &&
        (typeof bound !== "number" ||
          !Number.isSafeInteger(bound) ||
          bound < 0 ||
          bound > 1_000_000)
      ) {
        issues.push(
          issue(
            "invalid-field",
            `${path}.memberUploadQuota.${key}`,
            `${key} must be null or a bounded non-negative integer.`,
          ),
        );
      }
    }
  }
  return issues;
}

function analyzeJobsPause(value: unknown): NpSettingContractIssue[] {
  const result = npAnalyzeJobsPauseState(value);
  return result.ok
    ? []
    : result.issues.map((entry) =>
        issue(
          "invalid-field",
          entry.path.replace(/^jobs\.pause/u, "settings.jobs.paused"),
          entry.message,
        ),
      );
}

function analyzePatterns(value: unknown): NpSettingContractIssue[] {
  const path = "settings.page-builder.patterns";
  if (!Array.isArray(value) || value.length > 200) {
    return [issue("shape", path, "page-builder patterns must be an array of at most 200 entries.")];
  }
  const issues: NpSettingContractIssue[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const itemPath = `${path}.${index.toString()}`;
    if (!isPlainRecord(entry)) {
      issues.push(issue("shape", itemPath, "pattern must be a plain object."));
      continue;
    }
    pushUnknown(
      entry,
      new Set(["id", "label", "description", "blocks", "createdAt", "updatedAt"]),
      itemPath,
      issues,
    );
    if (
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      entry.id.length > 160 ||
      ids.has(entry.id)
    ) {
      issues.push(
        issue("invalid-field", `${itemPath}.id`, "pattern id must be unique bounded text."),
      );
    } else ids.add(entry.id);
    if (
      typeof entry.label !== "string" ||
      entry.label.trim().length === 0 ||
      entry.label.length > 160
    ) {
      issues.push(
        issue(
          "invalid-field",
          `${itemPath}.label`,
          "pattern label must be bounded non-empty text.",
        ),
      );
    }
    if (entry.description !== undefined && !isBoundedText(entry.description, 1000, true)) {
      issues.push(
        issue(
          "invalid-field",
          `${itemPath}.description`,
          "pattern description must be bounded text.",
        ),
      );
    }
    const blocks = npValidateBlockContent(entry.blocks);
    if (!blocks.ok) issues.push(issue("invalid-field", `${itemPath}.blocks`, blocks.message));
    if (!isIsoDate(entry.createdAt))
      issues.push(
        issue("invalid-field", `${itemPath}.createdAt`, "createdAt must be ISO date text."),
      );
    if (!isIsoDate(entry.updatedAt))
      issues.push(
        issue("invalid-field", `${itemPath}.updatedAt`, "updatedAt must be ISO date text."),
      );
  }
  return issues;
}

export function npAnalyzeSettingValue(key: unknown, value: unknown): NpSettingContractIssue[] {
  const kind = npClassifySettingKey(key);
  if (!kind) {
    const validation = npValidateSettingKey(key);
    return validation.ok
      ? [issue("unknown-key", "settings.key", "unsupported settings key.")]
      : [validation.issue];
  }
  switch (kind) {
    case "seo":
      return npAnalyzeSeoSettings(value);
    case "theme-tokens":
      return npAnalyzeThemeTokensOverlay(value).map((entry) => ({
        code: "invalid-field" as const,
        path: entry.path.replace(/^theme/u, "settings.theme"),
        message: entry.message,
      }));
    case "community":
      return analyzeCommunity(value);
    case "active-theme":
      return typeof value === "string" && ownerPattern.test(value)
        ? []
        : [
            issue(
              "invalid-field",
              "settings.activeTheme",
              "activeTheme must be a canonical registered-theme id.",
            ),
          ];
    case "theme-settings":
    case "plugin-config":
      return analyzeVersionedEnvelope(value, `settings.${String(key)}`);
    case "page-builder-patterns":
      return analyzePatterns(value);
    case "jobs-pause":
      return analyzeJobsPause(value);
  }
}

/** Validates a complete `np_settings` row, including its site/global scope. */
export function npAnalyzeSettingRecord(
  siteId: unknown,
  key: unknown,
  value: unknown,
): NpSettingContractIssue[] {
  const issues = npAnalyzeSettingValue(key, value);
  const kind = npClassifySettingKey(key);
  if (kind === "jobs-pause") {
    if (siteId !== "_system") {
      issues.push(
        issue(
          "invalid-field",
          "settings.siteId",
          'jobs.paused must use the reserved global site id "_system".',
        ),
      );
    }
  } else if (!npIsCanonicalSiteId(siteId)) {
    issues.push(
      issue(
        "invalid-field",
        "settings.siteId",
        "site-scoped settings must use a canonical site id.",
      ),
    );
  }
  return issues;
}

export function npValidateSettingValue(key: unknown, value: unknown): NpSettingValidationResult {
  const first = npAnalyzeSettingValue(key, value)[0];
  return first ? { ok: false, issue: first } : { ok: true };
}

export function npAssertSettingValue(key: string, value: unknown): void {
  const validation = npValidateSettingValue(key, value);
  if (!validation.ok) {
    throw new Error(
      `Invalid persisted setting at ${validation.issue.path}: ${validation.issue.message}`,
    );
  }
}

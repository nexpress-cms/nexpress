export interface NpSiteRuntimeSettings {
  siteUrl: string | null;
  defaultLocale: string | null;
  timezone: string | null;
}

export interface NpSiteRecord {
  id: string;
  name: string;
  hostname: string | null;
  description: string | null;
  settings: NpSiteRuntimeSettings;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NpSiteWireRecord = Omit<NpSiteRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

/** Editable site identity projected from the canonical `np_sites` row. */
export interface NpSiteGeneralSettings {
  name: string;
  url: string | null;
  description: string | null;
  defaultLocale: string | null;
  timezone: string | null;
}

export interface NpSeoSettings {
  defaultOgImage: string | null;
  twitterHandle: string | null;
  defaultLocale: string;
}

export interface NpAdminSettingsSnapshot {
  site: NpSiteGeneralSettings;
  seo: NpSeoSettings;
}

export type NpSettingContractKind =
  | "seo"
  | "theme-tokens"
  | "community"
  | "active-theme"
  | "theme-settings"
  | "plugin-config"
  | "page-builder-patterns"
  | "jobs-pause";

export interface NpSettingContractIssue {
  readonly code: "shape" | "unknown-field" | "invalid-field" | "unknown-key";
  readonly path: string;
  readonly message: string;
}

export type NpSettingValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpSettingContractIssue };

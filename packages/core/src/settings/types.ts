import type { NpUserRole } from "../auth-contract/types.js";

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

export interface NpCreateSiteInput {
  id: string;
  name: string;
  hostname?: string | null;
  description?: string | null;
  settings?: NpSiteRuntimeSettings;
}

export type NpUpdateSiteInput = Partial<
  Pick<NpSiteRecord, "name" | "hostname" | "description" | "settings">
>;

export interface NpSiteSummaryWireRecord {
  id: string;
  name: string;
  hostname: string | null;
  isDefault: boolean;
}

export interface NpSiteMembershipRecord {
  siteId: string;
  userId: string;
  role: NpUserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type NpSiteMembershipWireRecord = Omit<NpSiteMembershipRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export interface NpSiteMembershipGrantInput {
  userId: string;
  role: NpUserRole;
}

export interface NpSiteUsage {
  collections: Record<string, number>;
  settings: number;
  navigation: number;
  slugHistory: number;
  memberships: number;
  stringOverrides: number;
  pluginStorage: number;
  comments: number;
  reactions: number;
  follows: number;
  mutes: number;
  notifications: number;
  reports: number;
  auditEvents: number;
  bans: number;
  memberRoles: number;
  total: number;
}

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

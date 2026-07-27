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
  media: number;
  mediaFolders: number;
  mediaRefs: number;
  comments: number;
  contentViews: number;
  reactions: number;
  follows: number;
  mutes: number;
  notifications: number;
  realtimeEvents: number;
  reports: number;
  auditEvents: number;
  bans: number;
  memberRoles: number;
  total: number;
}

export const npSiteQuotaMetrics = ["storageBytes", "documents", "jobEnqueuesPerHour"] as const;

export type NpSiteQuotaMetric = (typeof npSiteQuotaMetrics)[number];

/** Site-owned resource ceilings. `null` keeps that resource unlimited. */
export interface NpSiteQuotas {
  storageBytes: number | null;
  documents: number | null;
  jobEnqueuesPerHour: number | null;
}

/** Current resource usage measured against one site's quota contract. */
export interface NpSiteQuotaUsage {
  storageBytes: number;
  documents: number;
  /** `null` when the active queue cannot provide exact site history. */
  jobEnqueuesLastHour: number | null;
}

export interface NpSiteQuotaSnapshot {
  limits: NpSiteQuotas;
  usage: NpSiteQuotaUsage;
  exceeded: NpSiteQuotaMetric[];
  unavailable: NpSiteQuotaMetric[];
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
  | "site-quotas"
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

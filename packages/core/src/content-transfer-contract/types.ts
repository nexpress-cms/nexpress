import type { NpFieldConfig } from "../config/types.js";
import type { NpNavItem } from "../navigation/types.js";
import type { NpSiteGeneralSettings } from "../settings/types.js";
import type { NpThemeTokensOverlay } from "../theme/types.js";

export const NP_CONTENT_TRANSFER_VERSION = "3" as const;

export type NpContentTransferJsonPrimitive = string | number | boolean | null;
export type NpContentTransferJsonValue =
  | NpContentTransferJsonPrimitive
  | NpContentTransferJsonValue[]
  | { [key: string]: NpContentTransferJsonValue };

export interface NpContentTransferMediaItem {
  id: string;
  filename: string;
  hash: string;
  mimeType: string;
}

export interface NpContentTransferPluginState {
  id: string;
  enabled: boolean;
  config: Record<string, NpContentTransferJsonValue>;
  manifestVersion: string | null;
}

export type NpContentTransferDocument = Record<string, NpContentTransferJsonValue>;
export type NpContentTransferCollections = Record<string, NpContentTransferDocument[]>;

interface NpContentTransferEnvelopeBase {
  version: typeof NP_CONTENT_TRANSFER_VERSION;
  exportedAt: string;
  siteUrl: string | null;
  collectionsExported: string[];
  collections: NpContentTransferCollections;
  media: NpContentTransferMediaItem[];
}

export interface NpContentTransferFullEnvelope extends NpContentTransferEnvelopeBase {
  partial: false;
  site: NpSiteGeneralSettings;
  theme: NpThemeTokensOverlay | null;
  settings: Record<string, NpContentTransferJsonValue>;
  navigation: Record<string, NpNavItem[]>;
  plugins: NpContentTransferPluginState[];
}

export interface NpContentTransferPartialEnvelope extends NpContentTransferEnvelopeBase {
  partial: true;
}

export type NpContentTransferEnvelope =
  NpContentTransferFullEnvelope | NpContentTransferPartialEnvelope;

export interface NpContentTransferImportCounts {
  site: number;
  theme: number;
  settings: number;
  navigation: number;
  documentsCreated: number;
  documentsUpdated: number;
  mediaMatched: number;
  pluginsUpdated: number;
}

export interface NpContentTransferImportReport {
  imported: NpContentTransferImportCounts;
  warnings: string[];
  dryRun: boolean;
  partial: boolean;
}

export type NpContentTransferContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "limit" | "duplicate" | "invariant";

export interface NpContentTransferContractIssue {
  code: NpContentTransferContractIssueCode;
  path: string;
  message: string;
}

export type NpContentTransferContractResult<T> =
  | { ok: true; value: T; issues: readonly [] }
  | { ok: false; value: null; issues: readonly NpContentTransferContractIssue[] };

export interface NpContentTransferMediaReference {
  mediaId: string;
  path: string;
}

export interface NpContentTransferRelationshipReference {
  collection: string;
  documentId: string;
  path: string;
}

export interface NpContentTransferDocumentEntry {
  collection: string;
  documentId: string;
  document: NpContentTransferDocument;
  fields: readonly NpFieldConfig[];
}

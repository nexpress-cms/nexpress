import type { NpCommunityDocumentAudience } from "../community-contract/types.js";

export const npSearchVisibilities = ["public", "all"] as const;
export const npSearchAudienceModes = ["public", "all"] as const;
export const npSearchDocumentStatuses = [
  "draft",
  "scheduled",
  "published",
  "archived",
  "pending",
] as const;

export type NpSearchVisibility = (typeof npSearchVisibilities)[number];
export type NpSearchAudienceMode = (typeof npSearchAudienceModes)[number];
export type NpSearchDocumentStatus = (typeof npSearchDocumentStatuses)[number];
export type NpSearchSiteId = string;

export type NpSearchDocumentValue =
  | null
  | boolean
  | number
  | string
  | readonly NpSearchDocumentValue[]
  | { readonly [key: string]: NpSearchDocumentValue };

export type NpSearchDocument = Readonly<Record<string, NpSearchDocumentValue>>;
export type NpSearchResultDocument = NpSearchDocument & {
  readonly id: string;
  readonly siteId: string;
  readonly status: NpSearchDocumentStatus;
  readonly visibility: "public" | "private";
  readonly audience?: NpCommunityDocumentAudience;
};

/** Public Core input. Optional fields are normalized before adapter or DB dispatch. */
export interface NpSearchRequestInput {
  readonly q: string;
  readonly collections?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
  readonly locale?: string;
  readonly siteId?: NpSearchSiteId;
  readonly visibility?: NpSearchVisibility;
}

/** Exact normalized request before the current site fallback is resolved. */
export interface NpSearchRequest {
  readonly q: string;
  readonly collections?: readonly string[];
  readonly limit: number;
  readonly offset: number;
  readonly locale?: string;
  readonly siteId?: NpSearchSiteId;
  readonly visibility: NpSearchVisibility;
}

/** Exact normalized request after the current site fallback is resolved. */
export interface NpSearchResolvedRequest {
  readonly q: string;
  readonly collections?: readonly string[];
  readonly limit: number;
  readonly offset: number;
  readonly locale?: string;
  readonly siteId: NpSearchSiteId;
  readonly visibility: NpSearchVisibility;
}

/**
 * Framework-derived document-audience scope. `collections` contains only the
 * selected collections that opted into `community.audience`.
 */
export interface NpSearchAudienceScope {
  readonly mode: NpSearchAudienceMode;
  readonly collections: readonly string[];
}

/** Exact context supplied to an external search adapter. */
export interface NpSearchAdapterContext extends NpSearchResolvedRequest {
  readonly audience: NpSearchAudienceScope;
}

export interface NpSearchResultItem {
  readonly collection: string;
  readonly doc: NpSearchResultDocument;
  /** Adapter-defined relative score. Ordering remains authoritative. */
  readonly score?: number;
}

/**
 * Candidate envelope returned by adapters. Facets and pagination metadata are
 * framework-owned and are derived only after this value passes validation.
 */
export interface NpSearchAdapterResult {
  readonly results: readonly NpSearchResultItem[];
  readonly total: number;
  readonly perCollection: Readonly<Record<string, number>>;
}

export interface NpSearchIndexUpsert {
  readonly operation: "upsert";
  readonly collection: string;
  readonly siteId: string;
  readonly documentId: string;
  /** Framework observation time used by adapters to preserve overlapping writes. */
  readonly observedAt: string;
  readonly doc: NpSearchResultDocument;
}

export interface NpSearchIndexDelete {
  readonly operation: "delete";
  readonly collection: string;
  readonly siteId: string;
  readonly documentId: string;
  /** Framework observation time used by adapters to preserve overlapping writes. */
  readonly observedAt: string;
}

/** Exact latest-state mutation dispatched by durable content jobs. */
export type NpSearchIndexMutation = NpSearchIndexUpsert | NpSearchIndexDelete;

/**
 * One-shot collection snapshot supplied during a full reindex. The adapter
 * must consume `documents` completely before resolving and atomically publish
 * the replacement without discarding overlapping, later `write()` mutations.
 */
export interface NpSearchIndexReplaceContext {
  readonly collection: string;
  readonly siteId: "*";
  readonly startedAt: string;
  readonly documents: AsyncIterable<NpSearchIndexUpsert>;
}

export interface NpSearchIndexingAdapter {
  /** Declares the exact JSON document and latest-state mutation contract. */
  readonly contract: "document-v1";
  /** Apply one idempotent latest-state mutation. Must resolve to void. */
  write(mutation: NpSearchIndexMutation): void | Promise<void>;
  /** Replace one collection across all sites. Must resolve to void. */
  replaceCollection(context: NpSearchIndexReplaceContext): void | Promise<void>;
}

export interface NpSearchCollectionFacet {
  readonly collection: string;
  readonly label: string;
  readonly count: number;
  readonly selected: true;
}

/** Stable public Core/API result envelope. Every field is always present. */
export interface NpSearchResult extends NpSearchAdapterResult {
  readonly facets: readonly NpSearchCollectionFacet[];
  readonly limit: number;
  readonly offset: number;
  readonly hasNextPage: boolean;
}

export interface NpSearchAdapter {
  /** Canonical operator-visible adapter identifier. */
  readonly kind: string;
  /** Declares support for the exact document-audience scope in every search context. */
  readonly audience: "document-v1";
  search(
    context: NpSearchAdapterContext,
  ): NpSearchAdapterResult | null | undefined | Promise<NpSearchAdapterResult | null | undefined>;
  /** Optional external-index synchronization capability. */
  readonly indexing?: NpSearchIndexingAdapter;
  /** Optional terminal resource cleanup. Must resolve to void. */
  readonly shutdown?: () => void | Promise<void>;
}

export interface NpSearchReindexResult {
  readonly collection: string;
  readonly processed: number;
}

export interface NpSearchReindexResponse {
  readonly total: number;
  readonly collections: readonly NpSearchReindexResult[];
}

export type NpSearchContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "max-items" | "duplicate" | "invariant";

export interface NpSearchContractIssue {
  readonly code: NpSearchContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface NpSearchContractValidationResult<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly issues: readonly NpSearchContractIssue[];
}

export interface NpSearchAdapterFailure {
  readonly adapterKind: string;
  readonly operation: "dispatch" | "result-contract" | "shutdown";
  readonly message: string;
  readonly occurredAt: string;
}

export interface NpSearchIndexFailure {
  readonly adapterKind: string;
  readonly operation: "index-write" | "index-replace";
  readonly message: string;
  readonly occurredAt: string;
}

export interface NpSearchAdapterDiagnostics {
  readonly adapterKind: string | null;
  readonly audienceContract: "document-v1" | null;
  readonly indexingContract: "document-v1" | null;
  readonly dispatchFailures: number;
  readonly resultContractFailures: number;
  readonly indexWriteFailures: number;
  readonly indexReplaceFailures: number;
  readonly shutdownFailures: number;
  readonly lastFailure: NpSearchAdapterFailure | null;
  readonly lastIndexFailure: NpSearchIndexFailure | null;
}

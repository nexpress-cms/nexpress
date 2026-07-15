export const npSearchVisibilities = ["public", "all"] as const;
export const npSearchDocumentStatuses = [
  "draft",
  "scheduled",
  "published",
  "archived",
  "pending",
] as const;

export type NpSearchVisibility = (typeof npSearchVisibilities)[number];
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

/** Exact context supplied to an external search adapter. */
export interface NpSearchAdapterContext {
  readonly q: string;
  readonly collections?: readonly string[];
  readonly limit: number;
  readonly offset: number;
  readonly locale?: string;
  readonly siteId: NpSearchSiteId;
  readonly visibility: NpSearchVisibility;
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
  search(
    context: NpSearchAdapterContext,
  ): NpSearchAdapterResult | null | undefined | Promise<NpSearchAdapterResult | null | undefined>;
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

export interface NpSearchAdapterDiagnostics {
  readonly adapterKind: string | null;
  readonly dispatchFailures: number;
  readonly resultContractFailures: number;
  readonly shutdownFailures: number;
  readonly lastFailure: NpSearchAdapterFailure | null;
}

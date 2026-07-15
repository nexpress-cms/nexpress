/** `@nexpress/core/search` — search request, adapter, result, and reindex contracts. */

export {
  NpSearchContractError,
  npAnalyzeSearchAdapter,
  npAnalyzeSearchAdapterContext,
  npAnalyzeSearchAdapterResult,
  npAnalyzeSearchReindexResult,
  npAnalyzeSearchReindexResponse,
  npAnalyzeSearchRequest,
  npAnalyzeSearchResult,
  npCreateEmptySearchResult,
  npCreateSearchResult,
  npParseSearchApiQuery,
  npParseSearchReindexQuery,
  npRequireSearchAdapter,
  npRequireSearchAdapterContext,
  npRequireSearchAdapterResult,
  npRequireSearchCollectionSlug,
  npRequireSearchReindexResult,
  npRequireSearchReindexResponse,
  npRequireSearchRequest,
  npRequireSearchResult,
  npSearchAdapterKindPattern,
  npSearchCollectionSlugPattern,
  npSearchContractLimits,
} from "./contract.js";
export { npSearchDocumentStatuses, npSearchVisibilities } from "./types.js";
export type {
  NpSearchAdapter,
  NpSearchAdapterContext,
  NpSearchAdapterDiagnostics,
  NpSearchAdapterFailure,
  NpSearchAdapterResult,
  NpSearchCollectionFacet,
  NpSearchContractIssue,
  NpSearchContractIssueCode,
  NpSearchContractValidationResult,
  NpSearchDocument,
  NpSearchDocumentStatus,
  NpSearchDocumentValue,
  NpSearchReindexResult,
  NpSearchReindexResponse,
  NpSearchRequest,
  NpSearchRequestInput,
  NpSearchResult,
  NpSearchResultDocument,
  NpSearchResultItem,
  NpSearchSiteId,
  NpSearchVisibility,
} from "./types.js";

export {
  getSearchCollectionLabels,
  searchCollections,
  reindexCollection,
} from "../collections/search-api.js";
export {
  getSearchAdapter,
  getSearchAdapterDiagnostics,
  resetSearchAdapter,
  setSearchAdapter,
  shutdownSearchAdapter,
} from "../collections/search-adapter.js";

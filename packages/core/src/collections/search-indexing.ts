import { npRequireSearchIndexMutation } from "../search/contract.js";
import type {
  NpSearchIndexFailure,
  NpSearchIndexReplaceContext,
  NpSearchIndexUpsert,
} from "../search/types.js";
import { getCollectionConfig, getCollectionTable } from "./registry.js";
import { getSearchAdapter, npRecordSearchIndexFailure } from "./search-adapter.js";
import { npGetPersistedCollectionDocumentById } from "./pipeline.js";

interface SearchIndexDocumentRef {
  readonly documentId: string;
  readonly siteId: string;
}

type SearchIndexDocumentRefSource =
  Iterable<SearchIndexDocumentRef> | AsyncIterable<SearchIndexDocumentRef>;

function collectionSupportsSearch(collection: string): boolean {
  const table = getCollectionTable(collection) as Record<string, unknown>;
  return table.searchVector !== undefined;
}

async function reportIndexFailure(
  adapterKind: string,
  operation: NpSearchIndexFailure["operation"],
  message: string,
): Promise<void> {
  const error = new Error(message);
  const { getLogger } = await import("../observability/logger.js");
  getLogger().error("search index synchronization failed", {
    adapterKind,
    operation,
    error: message,
  });
  const { reportError } = await import("../observability/error-reporter.js");
  await reportError(error, {
    tags: { component: "search-adapter", adapterKind, operation },
  });
}

function indexingAudienceAware(collection: string): boolean {
  return getCollectionConfig(collection).community?.audience === true;
}

async function createLatestMutation(
  collection: string,
  documentId: string,
  siteId: string,
): Promise<ReturnType<typeof npRequireSearchIndexMutation>> {
  // Capture ordering before the read begins. A concurrent write that commits
  // after this observation must receive a later marker and remain authoritative;
  // stamping after hydration could incorrectly mark stale content as newer.
  const observedAt = new Date().toISOString();
  const doc = await npGetPersistedCollectionDocumentById(collection, documentId, siteId);
  return npRequireSearchIndexMutation(
    doc
      ? { operation: "upsert", collection, documentId, siteId, observedAt, doc }
      : { operation: "delete", collection, documentId, siteId, observedAt },
    indexingAudienceAware(collection),
  );
}

/** Worker boundary: converge one external index entry on the latest persisted state. */
export async function npSyncSearchIndexDocument(
  collection: string,
  documentId: string,
  siteId: string,
): Promise<void> {
  const adapter = getSearchAdapter();
  const indexing = adapter?.indexing;
  if (!adapter || !indexing) return;

  try {
    if (!collectionSupportsSearch(collection)) return;
    const mutation = await createLatestMutation(collection, documentId, siteId);
    const result: unknown = await indexing.write(mutation);
    if (result !== undefined) {
      throw new TypeError("Search indexing write() must resolve to void.");
    }
  } catch (error) {
    const message = npRecordSearchIndexFailure(adapter.kind, "index-write", error);
    await reportIndexFailure(adapter.kind, "index-write", message).catch(() => undefined);
    throw error;
  }
}

/** Reindex boundary: stream and atomically replace one collection across all sites. */
export async function npReplaceSearchCollectionIndex(
  collection: string,
  refs: SearchIndexDocumentRefSource,
  startedAt: string,
): Promise<void> {
  const adapter = getSearchAdapter();
  const indexing = adapter?.indexing;
  if (!adapter || !indexing) return;

  let claimed = false;
  let completed = false;
  const audienceAware = indexingAudienceAware(collection);
  async function* streamDocuments(): AsyncGenerator<NpSearchIndexUpsert> {
    for await (const ref of refs) {
      const mutation = await createLatestMutation(collection, ref.documentId, ref.siteId);
      if (mutation.operation === "upsert") yield mutation;
    }
    completed = true;
  }
  const documents: AsyncIterable<NpSearchIndexUpsert> = Object.freeze({
    [Symbol.asyncIterator](): AsyncIterator<NpSearchIndexUpsert> {
      if (claimed) {
        throw new TypeError("Search replacement documents are a one-shot stream.");
      }
      claimed = true;
      const source = streamDocuments();
      return {
        async next() {
          const next = await source.next();
          if (!next.done) {
            return {
              done: false,
              value: npRequireSearchIndexMutation(next.value, audienceAware) as NpSearchIndexUpsert,
            };
          }
          return { done: true, value: undefined };
        },
        async return() {
          return source.return(undefined);
        },
        async throw(error?: unknown) {
          return source.throw(error);
        },
      };
    },
  });
  const context: NpSearchIndexReplaceContext = Object.freeze({
    collection,
    siteId: "*",
    startedAt,
    documents,
  });

  try {
    const result: unknown = await indexing.replaceCollection(context);
    if (result !== undefined) {
      throw new TypeError("Search indexing replaceCollection() must resolve to void.");
    }
    if (!claimed || !completed) {
      throw new TypeError(
        "Search indexing replaceCollection() must consume the document stream completely before resolving.",
      );
    }
  } catch (error) {
    const message = npRecordSearchIndexFailure(adapter.kind, "index-replace", error);
    await reportIndexFailure(adapter.kind, "index-replace", message).catch(() => undefined);
    throw error;
  }
}

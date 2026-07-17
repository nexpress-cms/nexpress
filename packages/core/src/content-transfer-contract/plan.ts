import {
  NpContentTransferContractError,
  npCompareContentTransferText,
  npContentTransferCollectionSlugPattern,
  npContentTransferUuidPattern,
} from "./contract.js";
import { npCollectContentTransferRelationshipReferences } from "./media.js";
import type { NpContentTransferDocumentEntry } from "./types.js";

const COLLECTION_SLUG = new RegExp(npContentTransferCollectionSlugPattern, "u");
const DOCUMENT_ID = new RegExp(npContentTransferUuidPattern, "u");

function pushReady(heap: string[], value: string): void {
  let index = heap.length;
  heap.push(value);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const parentValue = heap[parent];
    if (parentValue === undefined || npCompareContentTransferText(parentValue, value) <= 0) break;
    heap[index] = parentValue;
    index = parent;
  }
  heap[index] = value;
}

function popReady(heap: string[]): string | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (first === undefined || last === undefined || heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const leftValue = heap[left];
    const rightValue = heap[right];
    if (leftValue === undefined) break;
    const child =
      rightValue !== undefined && npCompareContentTransferText(rightValue, leftValue) < 0
        ? right
        : left;
    const childValue = heap[child];
    if (childValue === undefined || npCompareContentTransferText(last, childValue) <= 0) break;
    heap[index] = childValue;
    index = child;
  }
  heap[index] = last;
  return first;
}

export function npContentTransferDocumentKey(collection: string, documentId: string): string {
  const validCollection = COLLECTION_SLUG.test(collection);
  if (!validCollection || !DOCUMENT_ID.test(documentId)) {
    throw new NpContentTransferContractError("Invalid content-transfer document identity", [
      {
        code: "invalid-field",
        path: validCollection ? "documentId" : "collection",
        message: validCollection
          ? "must be a canonical UUID"
          : "must be a canonical collection slug",
      },
    ]);
  }
  return `${collection}:${documentId}`;
}

/**
 * Orders creates/updates so every relationship target that is also new in
 * this transfer is persisted before its source. Existing target rows remove
 * the dependency. New cyclic graphs fail before the import mutates state.
 */
export function npOrderContentTransferDocumentEntries<T extends NpContentTransferDocumentEntry>(
  entries: readonly T[],
  existingKeys: ReadonlySet<string> = new Set(),
): T[] {
  const byKey = new Map<string, T>();
  for (const entry of entries) {
    const key = npContentTransferDocumentKey(entry.collection, entry.documentId);
    if (byKey.has(key)) {
      throw new NpContentTransferContractError("Invalid content-transfer document plan", [
        { code: "duplicate", path: key, message: "document identity is repeated" },
      ]);
    }
    byKey.set(key, entry);
  }

  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const [key, entry] of byKey) {
    const required = new Set<string>();
    for (const reference of npCollectContentTransferRelationshipReferences(
      entry.fields,
      entry.document,
      `collections.${entry.collection}.${entry.documentId}`,
    )) {
      const targetKey = npContentTransferDocumentKey(reference.collection, reference.documentId);
      if (byKey.has(targetKey) && !existingKeys.has(targetKey)) required.add(targetKey);
    }
    dependencies.set(key, required);
    for (const target of required) {
      const current = dependents.get(target) ?? new Set<string>();
      current.add(key);
      dependents.set(target, current);
    }
  }

  const ready: string[] = [];
  for (const key of byKey.keys()) {
    if (dependencies.get(key)?.size === 0) pushReady(ready, key);
  }
  const ordered: T[] = [];
  while (ready.length > 0) {
    const key = popReady(ready);
    if (!key) break;
    const entry = byKey.get(key);
    if (entry) ordered.push(entry);
    for (const dependent of dependents.get(key) ?? []) {
      const remaining = dependencies.get(dependent);
      remaining?.delete(key);
      if (remaining?.size === 0) {
        pushReady(ready, dependent);
      }
    }
  }

  if (ordered.length !== entries.length) {
    const cyclic = [...dependencies]
      .filter(([, remaining]) => remaining.size > 0)
      .map(([key]) => key)
      .sort(npCompareContentTransferText);
    throw new NpContentTransferContractError("Invalid content-transfer document plan", [
      {
        code: "invariant",
        path: "collections",
        message: `new document relationship cycle cannot be imported: ${cyclic.join(", ")}`,
      },
    ]);
  }
  return ordered;
}

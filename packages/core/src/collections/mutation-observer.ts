import type { NpDocumentStatus } from "../config/types.js";
import type { NpTransaction } from "./pipeline.js";

export type NpCollectionMutationActorV1 =
  | { kind: "staff"; userId: string }
  | { kind: "member"; memberId: string }
  | { kind: "system"; component: string };

export interface NpCollectionRevisionFactV1 {
  id: string;
  version: number;
  status: "draft" | "published" | "autosave";
  createdAt: Date;
}

export type NpCollectionMutationFactV1 =
  | {
      kind: "document-save";
      operation: "create" | "update";
      status: NpDocumentStatus;
      revision: NpCollectionRevisionFactV1 | null;
    }
  | {
      kind: "revision-autosave";
      revision: NpCollectionRevisionFactV1 & { status: "autosave" };
    }
  | {
      /** Actual scheduled -> published or pending -> published transition. */
      kind: "scheduled-publish" | "member-promotion";
      revision: null;
    }
  | {
      kind: "document-delete";
      /** Status returned by the actual DELETE, not an earlier access read. */
      status: NpDocumentStatus;
      revision: null;
    };

export interface NpCollectionMutationObservationV1 {
  db: NpTransaction;
  siteId: string;
  collection: string;
  documentId: string;
  writeId: string;
  occurredAt: Date;
  actor: NpCollectionMutationActorV1;
  fact: NpCollectionMutationFactV1;
}

/** Explicit source-only receipt writer. Record on the supplied transaction;
 * never acquire Runtime/quota locks, dispatch Events or open another connection. */
export interface NpCollectionMutationObserverV1 {
  record(input: NpCollectionMutationObservationV1): Promise<void>;
}

let observer: NpCollectionMutationObserverV1 | null = null;

/** Framework-host bootstrap only. Absence leaves the existing collection write path unchanged. */
export function setCollectionMutationObserverV1(value: NpCollectionMutationObserverV1): void {
  if (typeof value?.record !== "function") throw new Error("Invalid collection mutation observer");
  observer = value;
}

export function resetCollectionMutationObserverV1(): void {
  observer = null;
}

/** Internal write owner captures installation once before awaiting hooks or database work. */
export function npGetCollectionMutationObserverV1(): NpCollectionMutationObserverV1 | null {
  return observer;
}

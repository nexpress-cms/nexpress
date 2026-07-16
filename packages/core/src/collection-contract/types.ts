import type { NpDocumentStatus } from "../config/types.js";

export const npCollectionDocumentStatuses = [
  "draft",
  "scheduled",
  "published",
  "archived",
  "pending",
] as const satisfies readonly NpDocumentStatus[];

export const npCollectionDocumentVisibilities = ["public", "private"] as const;

export type NpCollectionDocumentVisibility = (typeof npCollectionDocumentVisibilities)[number];

export type NpCollectionJsonPrimitive = string | number | boolean | null;
export type NpCollectionJsonValue =
  NpCollectionJsonPrimitive | NpCollectionJsonValue[] | { [key: string]: NpCollectionJsonValue };

export type NpCollectionDocumentValue =
  | NpCollectionJsonValue
  | Date
  | readonly NpCollectionDocumentValue[]
  | { readonly [key: string]: NpCollectionDocumentValue };

export interface NpCollectionDocumentBase {
  readonly id: string;
  readonly status: NpDocumentStatus;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly visibility: NpCollectionDocumentVisibility;
  readonly siteId: string;
}

/** Recursively converts server-side Date values to canonical API strings. */
export type NpCollectionWireValue<T> = T extends Date
  ? string
  : T extends readonly (infer Item)[]
    ? NpCollectionWireValue<Item>[]
    : T extends object
      ? { [Key in keyof T]: NpCollectionWireValue<T[Key]> }
      : T;

export type NpCollectionDocumentWire<T extends object = Record<string, unknown>> =
  NpCollectionWireValue<T>;

export type NpCollectionContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "max-items" | "duplicate" | "invariant";

export interface NpCollectionContractIssue {
  readonly code: NpCollectionContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type NpCollectionContractResult<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly [] }
  | {
      readonly ok: false;
      readonly value: null;
      readonly issues: readonly NpCollectionContractIssue[];
    };

/** Raw related-table rows supplied while a persisted document is hydrated. */
export interface NpCollectionDocumentRelations {
  readonly arrays?: Readonly<Record<string, readonly unknown[]>>;
  readonly hasMany?: Readonly<Record<string, readonly unknown[]>>;
}

export interface NpCollectionRuntimeDiagnostic {
  readonly collection: string;
  readonly operation: "read" | "write-result" | "hook-result" | "serialize";
  readonly message: string;
  readonly occurredAt: string;
}

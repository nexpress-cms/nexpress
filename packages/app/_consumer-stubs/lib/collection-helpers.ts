// Stub — see ./init-core.ts.
// Per-symbol any-typed exports added as needed by the framework
// pages that reference this module. Type-safe surfaces should be
// fleshed out incrementally.
export {};
declare global {
  // intentionally empty — see .d.ts pattern below
}

// Loose dynamic re-export catch-all — each helper is referenced
// by name in framework page imports; default to `any` for the
// stub so typecheck passes.

import type { NpSaveOptions } from "@nexpress/core";
export function parseBodyRecord(body: unknown): Record<string, unknown> { void body; return {}; }
export function extractSaveOptions(_data: Record<string, unknown>): NpSaveOptions | undefined { return undefined; }
// Bag of helpers destructured from `createCollectionRouteHelpers(...)`.
export const listDocuments: (..._args: any[]) => Promise<unknown> = () => Promise.resolve();
export const findDocument: (..._args: any[]) => Promise<unknown> = () => Promise.resolve();
export const createDocument: (..._args: any[]) => Promise<unknown> = () => Promise.resolve();
export const updateDocument: (..._args: any[]) => Promise<unknown> = () => Promise.resolve();
export const deleteDocument: (..._args: any[]) => Promise<unknown> = () => Promise.resolve();
export const bulkUpdate: (..._args: any[]) => Promise<unknown> = () => Promise.resolve();

export const findCollectionDocuments: (..._args: any[]) => Promise<any> = async () => ({ docs: [], totalDocs: 0, totalPages: 0, page: 1, limit: 10 });
export const getCollectionDocument: (..._args: any[]) => Promise<any> = async () => null;
export const saveCollectionDocument: (..._args: any[]) => Promise<any> = async () => null;
export const deleteCollectionDocument: (..._args: any[]) => Promise<any> = async () => null;
export const parseFindOptions: (..._args: any[]) => any = () => ({});

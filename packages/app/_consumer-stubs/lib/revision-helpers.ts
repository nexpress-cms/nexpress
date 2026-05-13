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

export const listRevisions: (..._args: any[]) => Promise<unknown[]> = async () => [];
export const getRevision: (..._args: any[]) => Promise<unknown> = async () => null;
export const restoreRevision: (..._args: any[]) => Promise<unknown> = async () => null;

export const listDocumentRevisions: (..._args: any[]) => Promise<any[]> = async () => [];
export const getDocumentRevision: (..._args: any[]) => Promise<any> = async () => null;
export const restoreDocumentRevision: (..._args: any[]) => Promise<any> = async () => null;
export const parseRevisionListOptions: (..._args: any[]) => any = () => ({});

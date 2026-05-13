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

import type { NpDb } from "@nexpress/next";
export function getDb(): NpDb { throw new Error("stub"); }
export const nexpressConfig: { collections: Array<any>; site?: { url?: string; name?: string }; [k: string]: any } = { collections: [] };
export type { NpDb };

export const reloadPlugins: () => Promise<void> = async () => {};

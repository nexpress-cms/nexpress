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

import type { NpCollectionConfig } from "@nexpress/core"
type NpBlockDefinition = any;
export interface NpFieldManifest { [k: string]: any }
export interface NpCollectionManifest { [k: string]: any }
export interface NpBlockManifest { [k: string]: any }
export interface NpPluginManifest { [k: string]: any }
export function collectionToManifest(_c: NpCollectionConfig): NpCollectionManifest { return {}; }
export function blockToManifest(_b: NpBlockDefinition): NpBlockManifest { return {}; }

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

import type { NpAuthUser } from "@nexpress/core";
export interface SeedPagesResult { created: number }
export interface SeedPostsResult { created: number }
export interface SeedTermsResult { tagsCreated: number; categoriesCreated: number }
export interface SeedNavigationResult { header: number; footer: number }
export interface SeedAllResult { pages: SeedPagesResult; posts: SeedPostsResult; terms: SeedTermsResult; navigation: SeedNavigationResult }
export async function seedTerms(_actor: NpAuthUser): Promise<SeedTermsResult> { return { tagsCreated: 0, categoriesCreated: 0 }; }
export async function seedPages(_actor: NpAuthUser): Promise<SeedPagesResult> { return { created: 0 }; }
export async function seedPosts(_actor: NpAuthUser): Promise<SeedPostsResult> { return { created: 0 }; }
export async function seedNavigation(_actor: NpAuthUser): Promise<SeedNavigationResult> { return { header: 0, footer: 0 }; }
export async function seedAll(_actor: NpAuthUser): Promise<SeedAllResult> { return { pages: { created: 0 }, posts: { created: 0 }, terms: { tagsCreated: 0, categoriesCreated: 0 }, navigation: { header: 0, footer: 0 } }; }

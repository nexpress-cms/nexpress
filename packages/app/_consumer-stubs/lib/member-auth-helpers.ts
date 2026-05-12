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

import type { NextRequest } from "next/server";
export interface NpAuthMember { id: string; handle: string; [k: string]: unknown }
export async function requireMember(_request?: NextRequest): Promise<NpAuthMember> { throw new Error("stub"); }
export async function optionalMember(_request?: NextRequest): Promise<NpAuthMember | null> { return null; }
export const memberAuthHelpers: any = {};
export type MemberAuthCookieTokens = { access: string; refresh: string };
export interface MemberAuthRuntimeConfig { secret: string; tokenExpiration: number; refreshTokenExpiration: number; }

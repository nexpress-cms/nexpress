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

export const memberAuthRoutes: Record<string, (..._args: any[]) => Promise<Response>> = {};
export const staffAuthRoutes: Record<string, (..._args: any[]) => Promise<Response>> = {};

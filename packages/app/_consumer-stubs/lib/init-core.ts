// Stubs for typechecking @nexpress/app in isolation.
//
// The real `@/lib/init-core` lives in each consumer project
// (apps/web, scaffolded sites). Next.js — with @nexpress/app in
// its `transpilePackages` list — compiles pages from this package
// using the consumer's tsconfig, so `@/*` resolves to the
// consumer's actual `@/lib/init-core` at runtime.
//
// For `tsc --noEmit` inside this package, those imports need a
// type-stable target. These stubs declare the contract: any
// consumer's `@/lib/init-core` must expose `ensureFor`. If the
// shape grows, mirror it here.

export async function ensureFor(
  intent: "read" | "plugins" | "write",
): Promise<void> {
  void intent;
}

export const nexpressConfig: {
  collections: Array<any>;
  site: { url?: string; name?: string; [k: string]: any };
  jobs?: {
    stuckThreshold?: { failed?: number; expired?: number };
    [k: string]: any;
  };
  [k: string]: any;
} = { collections: [], site: {} };

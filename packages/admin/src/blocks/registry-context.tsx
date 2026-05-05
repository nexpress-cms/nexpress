"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getRegisteredBlockMetadata, type NpBlockMetadata } from "@nexpress/blocks";

// Block metadata travels server → client through this context. The
// admin's protected layout reads `getRegisteredBlockMetadata()`
// at request time (server-side, after bootstrap → after plugin
// registration) and mounts <BlocksRegistryProvider> with the list.
//
// Why a context: `@nexpress/blocks`'s shared registry is module-
// scoped, so the browser-side instance only ever has the built-in
// defaults — `bootstrap.ts` runs in Node and pushes plugin blocks
// into the SERVER instance. Without this provider the admin's
// Add-block popover would silently miss every plugin contribution.
const BlocksRegistryContext = createContext<NpBlockMetadata[] | null>(null);

export function BlocksRegistryProvider({
  metadata,
  children,
}: {
  metadata: NpBlockMetadata[];
  children: ReactNode;
}) {
  return (
    <BlocksRegistryContext.Provider value={metadata}>
      {children}
    </BlocksRegistryContext.Provider>
  );
}

/**
 * Returns the block metadata list — defaults + plugin contributions
 * resolved server-side. Falls back to the browser's local registry
 * (built-ins only) when the provider isn't mounted, so non-admin
 * consumers and tests still get a useful answer.
 */
export function useBlocksRegistry(): NpBlockMetadata[] {
  const fromContext = useContext(BlocksRegistryContext);
  if (fromContext) return fromContext;
  return getRegisteredBlockMetadata();
}

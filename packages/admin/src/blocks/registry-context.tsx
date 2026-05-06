"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  getRegisteredBlockMetadata,
  getRegisteredPatterns,
  type NpBlockMetadata,
  type NpPattern,
} from "@nexpress/blocks";

interface RegistryContextValue {
  metadata: NpBlockMetadata[];
  /**
   * Collection-slug option list for `propsSchema` fields whose `type` is
   * `"collection"`. Resolved server-side via `getAllCollectionSlugs()`
   * after bootstrap, then handed to the provider so the form-renderer
   * can render a real select instead of forcing the operator to type a
   * slug by hand. Empty array when the host hasn't supplied it (older
   * mounts) — the field falls back to a free-text input in that case.
   */
  collectionOptions: Array<{ label: string; value: string }>;
  /**
   * Plugin / theme contributed patterns. Resolved server-side via
   * `getRegisteredPatterns()` after bootstrap and handed to the
   * provider so the page-builder's command-menu pattern picker
   * surfaces them alongside built-in and operator-saved patterns.
   * Empty when the host hasn't supplied it (older mounts) — the
   * editor still works with built-ins + custom (server/local).
   */
  patterns: NpPattern[];
}

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
const BlocksRegistryContext = createContext<RegistryContextValue | null>(null);

export function BlocksRegistryProvider({
  metadata,
  collectionOptions,
  patterns,
  children,
}: {
  metadata: NpBlockMetadata[];
  /**
   * Optional. Pre-built option list from the host's collection registry.
   * The host server component should pass
   * `getAllCollectionSlugs().map((slug) => ({ label: slug, value: slug }))`
   * after bootstrap finishes — same lifecycle hook as the metadata.
   */
  collectionOptions?: Array<{ label: string; value: string }>;
  /**
   * Optional. Plugin / theme contributed patterns. The host server
   * component should pass `getRegisteredPatterns()` from
   * `@nexpress/blocks` after bootstrap finishes. Empty / undefined
   * is fine — the editor falls back to built-ins + custom only.
   */
  patterns?: NpPattern[];
  children: ReactNode;
}) {
  return (
    <BlocksRegistryContext.Provider
      value={{
        metadata,
        collectionOptions: collectionOptions ?? [],
        patterns: patterns ?? [],
      }}
    >
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
  if (fromContext) return fromContext.metadata;
  return getRegisteredBlockMetadata();
}

/**
 * Returns the collection-slug option list for `propsSchema` fields
 * whose `type` is `"collection"`. Empty when the provider hasn't been
 * mounted with options (older host code) — the form-renderer treats
 * an empty list as "fall back to a free-text input".
 */
export function useCollectionOptions(): Array<{ label: string; value: string }> {
  const fromContext = useContext(BlocksRegistryContext);
  return fromContext?.collectionOptions ?? [];
}

/**
 * Returns the plugin / theme contributed pattern list. Falls back
 * to the browser's local registry (which is empty in the browser —
 * the registry is server-populated) when the provider isn't
 * mounted, so non-admin consumers still get a useful answer.
 */
export function useContributedPatterns(): NpPattern[] {
  const fromContext = useContext(BlocksRegistryContext);
  if (fromContext) return fromContext.patterns;
  return getRegisteredPatterns();
}

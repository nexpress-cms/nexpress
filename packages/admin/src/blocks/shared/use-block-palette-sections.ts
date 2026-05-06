"use client";

import { useEffect, useMemo, useState } from "react";
import type { NpBlockMetadata } from "@nexpress/blocks";

/**
 * Categorized palette section. The order across sections is
 * driven by `CATEGORY_ORDER`; the order within a section is the
 * order blocks were registered (i.e. plugin order). Favorites and
 * Recent are virtual sections sourced from localStorage rather
 * than from `category`.
 */
export interface PaletteSection {
  category: string;
  items: NpBlockMetadata[];
}

const RECENT_KEY = "np-page-builder.recent-blocks";
const RECENT_LIMIT = 5;
const FAVORITES_KEY = "np-page-builder.favorite-blocks";

export const PALETTE_CATEGORY_ORDER = [
  "Favorites",
  "Recent",
  "Layout",
  "Content",
  "Media",
  "Commerce",
  "Community",
  "Plugin",
  "Other",
] as const;

function categoryOf(block: NpBlockMetadata): string {
  if (block.category && block.category.trim().length > 0) return block.category;
  if (block.source === "plugin") return "Plugin";
  return "Other";
}

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function writeRecent(types: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(types));
  } catch {
    // localStorage unavailable / quota exceeded — recent list is a
    // nice-to-have, not load-bearing.
  }
}

function readFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeFavorites(types: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(types)));
  } catch {
    // Same as recent — favorites are a nice-to-have, never crash.
  }
}

function buildSections(
  availableBlocks: NpBlockMetadata[],
  recent: string[],
  favorites: Set<string>,
): PaletteSection[] {
  const byType = new Map(availableBlocks.map((b) => [b.type, b]));

  const favoriteItems: NpBlockMetadata[] = [];
  for (const type of favorites) {
    const block = byType.get(type);
    if (block) favoriteItems.push(block);
  }

  const recentItems: NpBlockMetadata[] = [];
  for (const type of recent) {
    if (favorites.has(type)) continue;
    const block = byType.get(type);
    if (block) recentItems.push(block);
    if (recentItems.length >= RECENT_LIMIT) break;
  }

  const buckets = new Map<string, NpBlockMetadata[]>();
  for (const block of availableBlocks) {
    const cat = categoryOf(block);
    const list = buckets.get(cat) ?? [];
    list.push(block);
    buckets.set(cat, list);
  }

  const sections: PaletteSection[] = [];
  if (favoriteItems.length > 0) {
    sections.push({ category: "Favorites", items: favoriteItems });
  }
  if (recentItems.length > 0) {
    sections.push({ category: "Recent", items: recentItems });
  }
  for (const cat of PALETTE_CATEGORY_ORDER) {
    if (cat === "Favorites" || cat === "Recent") continue;
    const items = buckets.get(cat);
    if (items && items.length > 0) {
      sections.push({ category: cat, items });
      buckets.delete(cat);
    }
  }
  const remaining = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [cat, items] of remaining) {
    sections.push({ category: cat, items });
  }
  return sections;
}

export function matchesQuery(block: NpBlockMetadata, query: string): boolean {
  if (!query) return true;
  const haystacks = [
    block.label,
    block.type,
    block.description ?? "",
    block.category ?? "",
    ...(block.keywords ?? []),
  ];
  for (const h of haystacks) {
    if (h.toLowerCase().includes(query)) return true;
  }
  return false;
}

interface UseBlockPaletteSectionsArgs {
  availableBlocks: NpBlockMetadata[];
  query: string;
  /** When the consumer is open. Refreshes recent + favorites from storage. */
  open: boolean;
}

interface UseBlockPaletteSectionsResult {
  sections: PaletteSection[];
  filteredSections: PaletteSection[];
  favorites: Set<string>;
  toggleFavorite: (type: string) => void;
  pushRecent: (type: string) => void;
}

/**
 * Shared palette logic — sections (favorites/recent/category),
 * search filtering, and favorite/recent localStorage persistence.
 *
 * Used by both the legacy popover (`BlockPalette`) and the new
 * modal (`PaletteModal`). Pure-ish (touches localStorage on open
 * + on toggle/push), no Radix bindings — the consumer renders the
 * surface.
 */
export function useBlockPaletteSections({
  availableBlocks,
  query,
  open,
}: UseBlockPaletteSectionsArgs): UseBlockPaletteSectionsResult {
  const [recent, setRecent] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (open) {
      setRecent(readRecent());
      setFavorites(readFavorites());
    }
  }, [open]);

  const sections = useMemo(
    () => buildSections(availableBlocks, recent, favorites),
    [availableBlocks, recent, favorites],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return sections;
    return sections
      .filter((s) => s.category !== "Recent")
      .map((s) => ({
        category: s.category,
        items: s.items.filter((b) => matchesQuery(b, normalizedQuery)),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, normalizedQuery]);

  const toggleFavorite = (type: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      writeFavorites(next);
      return next;
    });
  };

  const pushRecent = (type: string) => {
    setRecent((current) => {
      const next = [type, ...current.filter((t) => t !== type)].slice(0, RECENT_LIMIT);
      writeRecent(next);
      return next;
    });
  };

  return { sections, filteredSections, favorites, toggleFavorite, pushRecent };
}

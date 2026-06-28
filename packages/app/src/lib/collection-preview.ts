import type { NpCollectionConfig } from "@nexpress/core";

export function normalizePreviewPath(path: string | null | undefined): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  return path;
}

export function resolveCollectionPreviewPath(
  config: NpCollectionConfig,
  doc: Record<string, unknown>,
): string | null {
  const urlPath = config.seo?.urlPath;
  if (!urlPath) return null;
  try {
    return normalizePreviewPath(urlPath(doc));
  } catch {
    return null;
  }
}

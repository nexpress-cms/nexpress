const COLLAPSED_STORAGE_PREFIX = "np-page-builder.collapsed";

function getCollapsedStorageKey(scope?: string): string {
  const normalizedScope = scope?.trim();
  return normalizedScope
    ? `${COLLAPSED_STORAGE_PREFIX}.${normalizedScope}`
    : COLLAPSED_STORAGE_PREFIX;
}

function parseCollapsedIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function readCollapsedBlockIds(scope?: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseCollapsedIds(window.localStorage.getItem(getCollapsedStorageKey(scope)));
  } catch {
    return new Set();
  }
}

export function writeCollapsedBlockIds(scope: string | undefined, ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getCollapsedStorageKey(scope), JSON.stringify(Array.from(ids)));
  } catch {
    // Private mode / quota — drop the persistence, keep the
    // in-memory state. The collapsed set just resets next load.
  }
}

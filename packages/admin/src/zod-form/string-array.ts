export function normalizeStringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function formatStringArrayValue(value: unknown): string {
  return normalizeStringArrayValue(value).join("\n");
}

export function parseStringArrayDraft(draft: string): string[] {
  return draft
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function getStringArrayRows(value: unknown, draft: string | null): number {
  const lineCount =
    draft !== null ? draft.split(/\r?\n/).length : normalizeStringArrayValue(value).length;
  return Math.max(3, Math.min(12, lineCount + 1));
}

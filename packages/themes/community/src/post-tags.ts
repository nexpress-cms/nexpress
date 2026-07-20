import { findDocuments } from "@nexpress/core/collections";

export type CommunityTagValue =
  string | { id?: string; name?: string; label?: string; slug?: string };

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function relationshipId(tag: CommunityTagValue): string | null {
  if (typeof tag === "string") return UUID_PATTERN.test(tag) ? tag : null;
  if (tag.label || tag.name) return null;
  return tag.id && UUID_PATTERN.test(tag.id) ? tag.id : null;
}

function directLabel(tag: CommunityTagValue): string | null {
  if (typeof tag === "string") return UUID_PATTERN.test(tag) ? null : tag;
  return tag.label ?? tag.name ?? null;
}

/**
 * Relationship fields hydrate as target ids in the generic collection
 * pipeline. Resolve those ids in one bounded query so community cards never
 * expose storage UUIDs as labels while still accepting already-populated tag
 * objects from custom loaders.
 */
export async function hydrateCommunityPostTags<T extends { tags?: CommunityTagValue[] | null }>(
  docs: readonly T[],
): Promise<Array<Omit<T, "tags"> & { tags?: string[] }>> {
  const ids = Array.from(
    new Set(
      docs.flatMap((doc) =>
        (doc.tags ?? []).map(relationshipId).filter((id): id is string => !!id),
      ),
    ),
  );

  const labelsById = new Map<string, string>();
  if (ids.length > 0) {
    const result = await findDocuments<Record<string, unknown>>("tags", {
      where: { id: ids },
      limit: ids.length,
    });
    for (const tag of result.docs) {
      if (typeof tag.id === "string" && typeof tag.name === "string" && tag.name.length > 0) {
        labelsById.set(tag.id, tag.name);
      }
    }
  }

  return docs.map((doc) => {
    const labels = (doc.tags ?? [])
      .map((tag) => directLabel(tag) ?? labelsById.get(relationshipId(tag) ?? "") ?? null)
      .filter((label): label is string => !!label);
    const { tags: _tags, ...rest } = doc;
    return labels.length > 0 ? { ...rest, tags: labels } : rest;
  });
}

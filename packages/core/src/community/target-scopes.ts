import type { NpCollectionConfig } from "../config/types.js";
import { getCollectionConfig } from "../collections/registry.js";
import { npGetPersistedCollectionDocumentById } from "../collections/pipeline.js";
import type { CommunityScope } from "../community-contract/types.js";
import { NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

export interface NpCommunityTargetScope {
  type: CommunityScope;
  id: string;
}

export interface NpResolvedDocumentCommunityTarget {
  collection: string;
  documentId: string;
  document: Record<string, unknown>;
  ownerId: string | null;
  siteId: string;
  scopes: NpCommunityTargetScope[];
}

/** Member moderators never gain access to an initial staff-authored draft. */
export function npIsMemberModeratableDocument(
  config: NpCollectionConfig,
  document: Record<string, unknown>,
): boolean {
  const moderation = config.community?.moderation;
  if (!moderation) return false;
  return (
    typeof document.memberAuthorId === "string" ||
    (document.status === "published" && document.visibility === "public") ||
    document[moderation.hiddenField] === true
  );
}

function relationshipId(value: unknown, field: string): string {
  const id =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "id" in value && typeof value.id === "string"
        ? value.id
        : null;
  if (!id) {
    throw new NpValidationError("Invalid community scope projection", [
      {
        field,
        message: "Moderation category relationships must resolve to one document id.",
      },
    ]);
  }
  return id;
}

/**
 * Project one exact permission scope chain from a validated collection
 * document. Collection scope is universal. A collection that declares
 * `community.moderation` additionally contributes the document id as the
 * thread scope and its configured relationship as the category scope.
 */
export function npProjectDocumentCommunityScopes(
  config: NpCollectionConfig,
  document: Record<string, unknown>,
): NpCommunityTargetScope[] {
  const scopes: NpCommunityTargetScope[] = [];
  const moderation = config.community?.moderation;
  if (moderation) {
    if (typeof document.id !== "string" || document.id.length === 0) {
      throw new NpValidationError("Invalid community scope projection", [
        { field: "id", message: "Moderated documents require a stable document id." },
      ]);
    }
    scopes.push({ type: "thread", id: document.id });
    if (moderation.categoryField) {
      scopes.push({
        type: "category",
        id: relationshipId(document[moderation.categoryField], moderation.categoryField),
      });
    }
  }
  scopes.push({ type: "collection", id: config.slug });
  return scopes;
}

/** Load a persisted, current-site document and attach its canonical scopes. */
export async function npResolveDocumentCommunityTarget(
  collection: string,
  documentId: string,
): Promise<NpResolvedDocumentCommunityTarget> {
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const config = getCollectionConfig(collection);
  const document = await npGetPersistedCollectionDocumentById(collection, documentId, siteId);
  if (!document) throw new NpNotFoundError(collection, documentId);
  return {
    collection,
    documentId,
    document,
    ownerId: typeof document.memberAuthorId === "string" ? document.memberAuthorId : null,
    siteId,
    scopes: npProjectDocumentCommunityScopes(config, document),
  };
}

import type { NpPrincipal } from "../auth/principal.js";
import { getCollectionConfig } from "../collections/registry.js";
import type { NpCollectionConfig } from "../config/types.js";
import { npIsCommunityDocumentAudience } from "../community-contract/contract.js";
import type { NpCommunityDocumentAudience } from "../community-contract/types.js";
import { NpNotFoundError } from "../errors.js";

import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";
import { principalCan } from "./principal.js";
import { npProjectDocumentCommunityScopes } from "./target-scopes.js";

export interface NpCommunityDocumentReadOptions {
  /** Permit an owner or moderator to inspect pending/draft/private lifecycle rows. */
  allowUnpublished?: boolean;
}

export function npGetCommunityDocumentAudience(
  config: NpCollectionConfig,
  document: Readonly<Record<string, unknown>>,
): NpCommunityDocumentAudience | null {
  if (config.community?.audience !== true) return null;
  const value = document.audience;
  if (npIsCommunityDocumentAudience(value)) return value;
  npRecordCommunityRuntimeDiagnostic(
    "audience",
    `Collection ${config.slug} document ${typeof document.id === "string" ? document.id : "<unknown>"} has an invalid audience.`,
  );
  return null;
}

export function npPublicCommunityAudienceWhere(
  config: NpCollectionConfig,
): { audience: "public" } | Record<string, never> {
  return config.community?.audience === true ? { audience: "public" } : {};
}

async function isOwnerOrModerator(
  config: NpCollectionConfig,
  document: Readonly<Record<string, unknown>>,
  principal: NpPrincipal | null,
): Promise<boolean> {
  if (!principal) return false;
  const ownerId = typeof document.memberAuthorId === "string" ? document.memberAuthorId : null;
  if (principal.kind === "member" && ownerId === principal.memberId) return true;
  if (typeof document.id !== "string") return false;
  const scopes = npProjectDocumentCommunityScopes(config, document);
  const categoryField = config.community?.audienceCategoryField;
  if (categoryField) {
    const raw = document[categoryField];
    const categoryId =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string"
          ? raw.id
          : null;
    if (!categoryId) {
      npRecordCommunityRuntimeDiagnostic(
        "audience",
        `Collection ${config.slug} document ${document.id} has an invalid audience category scope.`,
      );
      return false;
    }
    if (!scopes.some((scope) => scope.type === "category" && scope.id === categoryId)) {
      scopes.unshift({ type: "category", id: categoryId });
    }
  }
  return principalCan(principal, "hide-thread", {
    type: "thread",
    id: document.id,
    ownerId: ownerId ?? undefined,
    scopes,
  });
}

/**
 * Resolve one document's audience against the canonical lifecycle envelope.
 * Collections without `community.audience` retain the historical
 * published/public rule.
 */
export async function npCanReadCommunityDocument(
  collection: string | NpCollectionConfig,
  document: Readonly<Record<string, unknown>>,
  principal: NpPrincipal | null = null,
  options: NpCommunityDocumentReadOptions = {},
): Promise<boolean> {
  const config = typeof collection === "string" ? getCollectionConfig(collection) : collection;
  const live = document.status === "published" && document.visibility === "public";
  const audience = npGetCommunityDocumentAudience(config, document);
  if (config.community?.audience === true && audience === null) return false;

  if (live) {
    if (audience === null || audience === "public") return true;
    if (audience === "members") return principal !== null;
    return isOwnerOrModerator(config, document, principal);
  }

  return options.allowUnpublished === true && isOwnerOrModerator(config, document, principal);
}

export async function npRequireReadableCommunityDocument(
  collection: string | NpCollectionConfig,
  document: Readonly<Record<string, unknown>>,
  principal: NpPrincipal | null = null,
  options: NpCommunityDocumentReadOptions = {},
): Promise<void> {
  const config = typeof collection === "string" ? getCollectionConfig(collection) : collection;
  if (!(await npCanReadCommunityDocument(config, document, principal, options))) {
    throw new NpNotFoundError(
      config.slug,
      typeof document.id === "string" ? document.id : "unknown",
    );
  }
}

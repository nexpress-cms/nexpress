import { getCollectionConfig } from "../collections/registry.js";
import { getDocumentById } from "../collections/pipeline.js";
import { npRequireEngagementTarget } from "../community-contract/contract.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

export interface NpResolvedDocumentEngagementTarget {
  targetType: string;
  targetId: string;
  siteId: string;
  recipientId: string | null;
}

export async function npResolveDocumentEngagementTarget(
  targetType: string,
  targetId: string,
  feature: "reactions" | "views" | "reports",
  options: { requirePublic?: boolean } = {},
): Promise<NpResolvedDocumentEngagementTarget> {
  const target = npRequireEngagementTarget({ targetType, targetId });
  const config = getCollectionConfig(target.targetType);
  if (config.community?.[feature] !== true) {
    throw new NpValidationError("Engagement disabled", [
      {
        field: "targetType",
        message: `Collection "${target.targetType}" has not enabled document ${feature}.`,
      },
    ]);
  }

  const document = await getDocumentById<Record<string, unknown>>(
    target.targetType,
    target.targetId,
  );
  if (!document) {
    throw new NpNotFoundError(target.targetType, target.targetId);
  }
  if (
    options.requirePublic !== false &&
    (document.status !== "published" || document.visibility !== "public")
  ) {
    throw new NpNotFoundError(target.targetType, target.targetId);
  }

  const requestSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const targetSiteId = typeof document.siteId === "string" ? document.siteId : NP_DEFAULT_SITE_ID;
  if (targetSiteId !== requestSiteId) {
    throw new NpForbiddenError("engagement", "cross-site");
  }

  return {
    ...target,
    siteId: targetSiteId,
    recipientId: typeof document.memberAuthorId === "string" ? document.memberAuthorId : null,
  };
}

import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentSourceReleases } from "../db/schema/agent.js";
import { npSettings } from "../db/schema/system.js";
import type { NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import {
  canonicalBodySiteId,
  canonicalBodyUtc,
} from "../agent-contract/canonical-body-validation.js";
import {
  npAgentGuardianSourceNamespaceDigestV1,
  npAgentGuardianSourceDeliveryKeyDigestV1,
  npRequireAgentGuardianSourceClosureV1,
  type NpAgentGuardianRetentionFamilyV1,
} from "../agent-contract/guardian-retention-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npRequireAgentSourceReleaseRecordV1 } from "./source-release-read.js";

export const npAgentGuardianSourceClosureKeyV1 = (family: NpAgentGuardianRetentionFamilyV1) =>
  `guardian.closure.${family}`;
/** Internal validation only. The caller owns the fresh same-site settings read
 * and admission lock; a closure can deny old delivery but grants no authority. */
export async function npReadAgentGuardianSourceClosureFromRetainedRowV1(
  siteId: string,
  family: NpAgentGuardianRetentionFamilyV1,
  row: { value: unknown } | undefined,
) {
  canonicalBodySiteId(siteId, "guardian.closure.siteId");
  if (row === undefined) return null;
  const value = npRequireAgentGuardianSourceClosureV1(row.value);
  if (
    value.siteId !== siteId ||
    value.family !== family ||
    value.namespaceDigest !== (await npAgentGuardianSourceNamespaceDigestV1(family))
  )
    throw new NpAgentGatewayError(
      "GUARDIAN_SOURCE_CLOSURE_INVALID",
      409,
      "Guardian historical delivery is unavailable.",
    );
  return value;
}
/** Caller owns the existing site admission lock. Content capture never calls this reader. */
export async function npReadAgentGuardianSourceClosureV1(
  db: ReturnType<typeof getDb>,
  siteId: string,
  family: NpAgentGuardianRetentionFamilyV1,
) {
  canonicalBodySiteId(siteId, "guardian.closure.siteId");
  const [row] = await db
    .select({ value: npSettings.value })
    .from(npSettings)
    .where(
      and(
        eq(npSettings.siteId, siteId),
        eq(npSettings.key, npAgentGuardianSourceClosureKeyV1(family)),
      ),
    )
    .limit(1);
  return npReadAgentGuardianSourceClosureFromRetainedRowV1(siteId, family, row);
}
export async function npIsAgentGuardianSourceDeliveryClosedFromRetainedRowV1(
  siteId: string,
  family: NpAgentGuardianRetentionFamilyV1,
  occurredAt: string,
  row: { value: unknown } | undefined,
): Promise<boolean> {
  canonicalBodyUtc(occurredAt, "guardian.closure.occurredAt");
  const closure = await npReadAgentGuardianSourceClosureFromRetainedRowV1(siteId, family, row);
  return closure !== null && occurredAt < closure.closedBefore;
}
export async function npIsAgentGuardianSourceDeliveryClosedV1(
  db: ReturnType<typeof getDb>,
  siteId: string,
  family: NpAgentGuardianRetentionFamilyV1,
  occurredAt: string,
): Promise<boolean> {
  canonicalBodyUtc(occurredAt, "guardian.closure.occurredAt");
  const closure = await npReadAgentGuardianSourceClosureV1(db, siteId, family);
  return closure !== null && occurredAt < closure.closedBefore;
}

/** Private source snapshot predicate. The caller must hold the site quota lock
 * until insertion; a negative lookup then stays current against retention. */
export async function npAgentGuardianDeliveryKeyLookupV1(event: NpAgentEventCanonicalV1) {
  const digest = await npAgentGuardianSourceDeliveryKeyDigestV1(event);
  return {
    digest,
    predicate: sql`${npAgentSourceReleases.siteId} = ${event.siteId}
      and ${npAgentSourceReleases.sourceKind} = ${"guardian-event"}
      and ${npAgentSourceReleases.evidenceBody}->>'deliveryKeyDigest' = ${digest}`,
  };
}

/** A compact consumed key can only deny delivery, never manufacture a successful replay. */
export async function npAssertAgentGuardianDeliveryKeyAvailableV1(
  db: ReturnType<typeof getDb>,
  event: NpAgentEventCanonicalV1,
  family: NpAgentGuardianRetentionFamilyV1,
): Promise<void> {
  const { digest, predicate } = await npAgentGuardianDeliveryKeyLookupV1(event);
  const [row] = await db.select().from(npAgentSourceReleases).where(predicate).limit(1);
  if (!row) return;
  const body = await npRequireAgentSourceReleaseRecordV1(row);
  if (
    body.kind !== "guardian-event" ||
    body.family !== family ||
    body.deliveryKeyDigest !== digest ||
    body.namespaceDigest !== (await npAgentGuardianSourceNamespaceDigestV1(family))
  )
    throw new NpAgentGatewayError(
      "GUARDIAN_SOURCE_RELEASE_INVALID",
      409,
      "Guardian historical delivery is unavailable.",
    );
  throw new NpAgentGatewayError(
    "GUARDIAN_SOURCE_ALREADY_RELEASED",
    409,
    "Guardian source delivery was already released.",
  );
}

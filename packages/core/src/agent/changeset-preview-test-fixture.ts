import { vi } from "vitest";
import type { NpTransaction } from "../collections/pipeline.js";
import {
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
} from "../agent-contract/canonical-changeset.js";
import type { NpAgentChangeSetSnapshotCanonicalV1 } from "../agent-contract/types.js";
import type { NpAgentChangeSetPreviewContextV1 } from "./changeset-preview-overlay.js";
const digest = `cj1:sha256:${"A".repeat(43)}`;
export async function previewFixture(
  handle = "preview",
): Promise<NpAgentChangeSetPreviewContextV1> {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const changeSetId = "11111111-1111-4111-8111-111111111111";
  const snapshot: NpAgentChangeSetSnapshotCanonicalV1 = {
    schemaVersion: "np.agent-changeset-snapshot.v1",
    siteId: "default",
    changeSetId,
    operationOrdinal: 1,
    canonicalResourceKey: { kind: "setting", key: "seo" },
    presence: "absent",
    base: null,
    value: null,
  };
  const plan: NpAgentChangeSetPreviewContextV1["plan"] = {
    schemaVersion: "np.agent-changeset-plan.v1",
    planKind: "changeset",
    siteId: "default",
    changeSetId,
    body: {
      draftVersion: 1,
      draftHash: digest,
      validationGeneration: 1,
      baseFingerprint: digest,
      operations: [
        {
          ordinal: 1,
          operation: {
            kind: "setting",
            operation: "replace",
            clientOperationId: "seo",
            reason: null,
            resource: { key: "seo" },
            base: null,
            input: {
              value: { defaultOgImage: null, twitterHandle: handle, defaultLocale: "en_US" },
            },
          },
          canonicalResourceKey: snapshot.canonicalResourceKey,
          beforeHash: digest,
          proposedAfterHash: digest,
          snapshotHash: await npDigestAgentChangeSetSnapshotCanonical(snapshot),
          rollbackClass: "full",
          residualCodes: [],
        },
      ],
      risk: {
        level: "medium",
        reasonCodes: ["PUBLIC_WRITE"],
        approvalMode: "human",
        reversible: true,
      },
      requiredScopes: ["changeset:apply"],
      requiredHumanCapabilities: ["admin.manage"],
      requiredHumanPredicates: [],
      policyHashes: [digest],
      expiresAt,
      rollbackWindowSeconds: 3600,
    },
  };
  return {
    siteId: "default",
    changeSetId,
    previewId: "22222222-2222-4222-8222-222222222222",
    generation: 1,
    planHash: await npDigestAgentChangeSetPlanCanonical(plan),
    previewContractFingerprint: digest,
    route: { route: "/", locale: null, audience: "public" },
    createdAt,
    expiresAt,
    plan,
    snapshots: [snapshot],
    now: new Date(),
    tx: {
      execute: vi.fn().mockResolvedValue({ rows: [{ transaction_read_only: "on" }] }),
    } as unknown as NpTransaction,
  };
}

import { saveDocument } from "../collections/pipeline.js";
import { sendEmail } from "../email/service.js";
import { enqueueJob } from "../jobs/queue.js";
import { npUploadStorageObject, npDeleteStorageObject } from "../storage/operations.js";
import { npInvalidateCache } from "../cache/runtime.js";
import { runHook, runHookAndCollect } from "../plugins/host.js";
import { describe, expect, it, vi } from "vitest";
import type { NpTransaction } from "../collections/pipeline.js";
import {
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
} from "../agent-contract/canonical-changeset.js";
import type { NpAgentChangeSetSnapshotCanonicalV1 } from "../agent-contract/types.js";
import { withCurrentSite } from "../sites/context.js";
import {
  withAgentChangeSetPreview,
  npAgentPreviewReadTransaction,
  npAgentPreviewSettingOverride,
  npAssertAgentPreviewEffectsAllowed,
  npGetAgentChangeSetPreviewContext,
  npIsAgentChangeSetPreview,
  type NpAgentChangeSetPreviewContextV1,
} from "./changeset-preview-overlay.js";
const digest = `cj1:sha256:${"A".repeat(43)}`;
async function fixture(handle = "preview"): Promise<NpAgentChangeSetPreviewContextV1> {
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
describe("ChangeSet preview async context", () => {
  it("requires an explicitly read-only transaction and verifies sealed evidence before rendering", async () => {
    const input = await fixture();
    const render = vi.fn();
    await expect(
      withAgentChangeSetPreview(
        {
          ...input,
          tx: {
            execute: vi.fn().mockResolvedValue({ rows: [{ transaction_read_only: "off" }] }),
          } as unknown as NpTransaction,
        },
        render,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      withAgentChangeSetPreview({ ...input, planHash: `cj1:sha256:${"B".repeat(43)}` }, render),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      withAgentChangeSetPreview({ ...input, snapshots: [] }, render),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(render).not.toHaveBeenCalled();
  });
  it("keeps frozen evidence, site and transaction binding across asynchronous reads without global mutation", async () => {
    const input = await fixture();
    await withAgentChangeSetPreview(input, async () => {
      await Promise.resolve();
      expect(await npAgentPreviewReadTransaction()).toBe(input.tx);
      expect(npAgentPreviewSettingOverride("seo")).toEqual({
        value: { defaultOgImage: null, twitterHandle: "preview", defaultLocale: "en_US" },
      });
      expect(() => {
        npGetAgentChangeSetPreviewContext()!.route.route = "/other";
      }).toThrow();
      expect(() => npAssertAgentPreviewEffectsAllowed()).toThrow("Effects are unavailable");
      await expect(
        withCurrentSite("other", () => npAgentPreviewReadTransaction()),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(npAgentPreviewReadTransaction({} as NpTransaction)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
    expect(npIsAgentChangeSetPreview()).toBe(false);
    expect(npAgentPreviewSettingOverride("seo")).toBeNull();
    expect(npGetAgentChangeSetPreviewContext()).toBeNull();
  });
  it("isolates concurrent preview generations and preserves an outer context after nested completion", async () => {
    const [first, second] = await Promise.all([fixture("first"), fixture("second")]);
    const observed = await Promise.all(
      [first, second].map((input) =>
        withAgentChangeSetPreview(input, async () => {
          await Promise.resolve();
          const before = npAgentPreviewSettingOverride("seo");
          await withAgentChangeSetPreview(input, () => Promise.resolve());
          expect(npAgentPreviewSettingOverride("seo")).toEqual(before);
          return before;
        }),
      ),
    );
    expect(observed).toEqual([
      { value: { defaultOgImage: null, twitterHandle: "first", defaultLocale: "en_US" } },
      { value: { defaultOgImage: null, twitterHandle: "second", defaultLocale: "en_US" } },
    ]);
    expect(npIsAgentChangeSetPreview()).toBe(false);
  });
  it("blocks actual framework effect facades before inputs, adapters or hooks execute", async () => {
    await withAgentChangeSetPreview(await fixture(), async () => {
      for (const method of [
        saveDocument,
        sendEmail,
        enqueueJob,
        npUploadStorageObject,
        npDeleteStorageObject,
        npInvalidateCache,
      ])
        await expect(Reflect.apply(method, undefined, [])).rejects.toMatchObject({
          statusCode: 403,
        });
      await expect(Reflect.apply(runHook, undefined, [])).resolves.toBeUndefined();
      await expect(Reflect.apply(runHookAndCollect, undefined, [])).resolves.toEqual([]);
    });
  });
  it("fences delayed descendants after the complete render and rejects expired output", async () => {
    const input = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let descendant!: Promise<void>;
    await withAgentChangeSetPreview(input, () => {
      descendant = gate.then(() => {
        expect(npIsAgentChangeSetPreview()).toBe(true);
        expect(() => npGetAgentChangeSetPreviewContext()).toThrow("Preview is unavailable");
        expect(() => npAssertAgentPreviewEffectsAllowed()).toThrow();
      });
      return Promise.resolve();
    });
    release();
    await descendant;
    const clock = vi.spyOn(Date, "now");
    try {
      await expect(
        withAgentChangeSetPreview(input, () => {
          clock.mockReturnValue(Date.parse(input.expiresAt) + 1000);
          return Promise.resolve();
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      clock.mockRestore();
    }
  });
});

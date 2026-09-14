import type { NpTransaction } from "../collections/pipeline.js";
import { previewFixture as fixture } from "./changeset-preview-test-fixture.js";
import { saveDocument } from "../collections/pipeline.js";
import { sendEmail } from "../email/service.js";
import { enqueueJob } from "../jobs/queue.js";
import { npUploadStorageObject, npDeleteStorageObject } from "../storage/operations.js";
import { npInvalidateCache } from "../cache/runtime.js";
import { runHook, runHookAndCollect } from "../plugins/host.js";
import { describe, expect, it, vi } from "vitest";
import { withCurrentSite } from "../sites/context.js";
import {
  withAgentChangeSetPreview,
  npAgentPreviewReadTransaction,
  npAgentPreviewSettingOverride,
  npAssertAgentPreviewEffectsAllowed,
  npGetAgentChangeSetPreviewContext,
  npIsAgentChangeSetPreview,
} from "./changeset-preview-overlay.js";
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

import { describe, expect, it, vi } from "vitest";
import {
  NpAgentConnectionAuthAdapterRegistryV1,
  npParseAgentProviderConnectionConfigV1,
  type NpAgentConnectionAuthAdapterV1,
  type NpAgentProviderNotificationFacetV1,
} from "./provider-auth-contract.js";
import { createAgentFakeProviderAdapterV1 } from "./provider-fake.js";
const id = "00000000-0000-4000-8000-000000000001";
describe("optional notification adapter facet", () => {
  it("freezes declared delivery semantics and binds send/shutdown to their owning facet", async () => {
    const channels: NpAgentProviderNotificationFacetV1["channels"][number][] = ["email", "webhook"];
    const shutdown = vi.fn(() => Promise.resolve());
    const facet: NpAgentProviderNotificationFacetV1 = {
      channels,
      idempotency: "enforced",
      send() {
        expect(this).toBe(facet);
        return Promise.resolve({ state: "confirmed", providerMessageId: "receipt" });
      },
      shutdown() {
        expect(this).toBe(facet);
        return shutdown();
      },
    };
    const base = createAgentFakeProviderAdapterV1();
    const inference = { invoke: vi.fn(() => Promise.reject(new Error("Unused fake inference"))) };
    const adapter = { ...base, notification: facet, inference };
    const registry = new NpAgentConnectionAuthAdapterRegistryV1().register(adapter);
    const registered = registry.resolve(adapter);
    channels.push("slack");
    expect(registered.notification!.channels).toEqual(["email", "webhook"]);
    expect(Object.isFrozen(registered.notification)).toBe(true);
    expect(Object.isFrozen(registered.notification!.channels)).toBe(true);
    expect(registered.inference).toBeDefined();
    const parsed = await npParseAgentProviderConnectionConfigV1({
      adapter: registered,
      siteId: "default",
      connectionId: id,
      kind: "notification",
      provider: base.id,
      authKind: "api_key",
      configVersion: 1,
      config: {
        accountId: "account",
        connectionKind: "notification",
        destination: "alerts",
        modelId: null,
      },
      dataProcessingCeiling: "internal-redacted",
    });
    const send = registered.notification!.send.bind(undefined);
    expect(
      await send(
        {
          schemaVersion: "np.agent-notification-delivery.v1",
          notificationId: id,
          channel: "email",
          deduplicationKey: "transition:1",
          payloadRedacted: { incidentId: id },
        },
        {
          connection: parsed,
          credentialLease: {
            secretVersionId: id,
            envelopeVersion: 1,
            expiresAt: "2026-10-17T00:00:00.000Z",
            use: () => Promise.reject(new Error("No credential needed")),
            dispose() {},
          },
          signal: new AbortController().signal,
        },
      ),
    ).toEqual({ state: "confirmed", providerMessageId: "receipt" });
    await registered.notification!.shutdown!();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
  it("rejects empty, unsorted, duplicate, local/admin or unknown channels and incomplete transport metadata", () => {
    const base = createAgentFakeProviderAdapterV1();
    const send = () => Promise.resolve({ state: "confirmed" as const, providerMessageId: null });
    for (const notification of [
      { channels: [], idempotency: "enforced", send },
      { channels: ["webhook", "email"], idempotency: "enforced", send },
      { channels: ["email", "email"], idempotency: "enforced", send },
      { channels: ["admin"], idempotency: "enforced", send },
      { channels: ["unknown"], idempotency: "enforced", send },
      { channels: ["email"], idempotency: "maybe", send },
      { channels: ["email"], idempotency: "enforced", send: null },
      { channels: ["email"], idempotency: "enforced", send, shutdown: true },
    ])
      expect(() =>
        new NpAgentConnectionAuthAdapterRegistryV1().register({
          ...base,
          notification,
        } as unknown as NpAgentConnectionAuthAdapterV1),
      ).toThrow();
    expect(() =>
      new NpAgentConnectionAuthAdapterRegistryV1().register({
        ...base,
        supportedConnectionKinds: ["model"],
        destinationDescriptorSchema: null,
        notification: { channels: ["email"], idempotency: "none", send },
      }),
    ).toThrow();
    expect(() => new NpAgentConnectionAuthAdapterRegistryV1().register(base)).not.toThrow();
  });
});

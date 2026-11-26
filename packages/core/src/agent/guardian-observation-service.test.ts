import { describe, expect, it, vi } from "vitest";
import {
  NP_GUARDIAN_REQUEST_SOURCE_RECEIPT_SCHEMA_V1,
  npGuardianRequestSourceMacV1,
  npRequireGuardianRequestSourceReceiptV1,
  npVerifyGuardianRequestSourceMacV1,
  type NpGuardianRequestSourceReceiptBodyV1,
} from "./guardian-request-source-receipt.js";
import {
  createAgentGuardianObservationServiceV1,
  npIsAgentGuardianAuthenticatedRequestSourceV1,
} from "./guardian-observation-service.js";

describe("Guardian observation work budget", () => {
  it("brands only immutable actual factories with an explicit independent receipt key", () => {
    const options = {
      actorKey: { id: "actor-1", bytes: new Uint8Array(32).fill(11) },
      isInstalledSite: () => Promise.resolve(false),
      authorize: () => Promise.resolve(),
      events: { record: vi.fn(() => Promise.reject(new Error("No source work expected"))) },
    };
    const manual = createAgentGuardianObservationServiceV1(options);
    expect(npIsAgentGuardianAuthenticatedRequestSourceV1(manual)).toBe(false);
    const signed = createAgentGuardianObservationServiceV1({
      ...options,
      receiptKey: { id: "receipt-1", bytes: new Uint8Array(32).fill(12) },
    });
    expect(npIsAgentGuardianAuthenticatedRequestSourceV1(signed)).toBe(true);
    expect(npIsAgentGuardianAuthenticatedRequestSourceV1({ ...signed })).toBe(false);
    expect(
      npIsAgentGuardianAuthenticatedRequestSourceV1({
        observe: (input: Parameters<typeof signed.observe>[0]) => signed.observe(input),
        verifyEvent: signed.verifyEvent,
        verifySignal: signed.verifySignal,
      }),
    ).toBe(false);
    expect(Object.isFrozen(signed)).toBe(true);
    expect(Reflect.set(signed, "verifySignal", () => true)).toBe(false);
    expect(options.events.record).not.toHaveBeenCalled();
    for (const receiptKey of [
      { id: "receipt-1", bytes: new Uint8Array(31) },
      options.actorKey,
      { id: "bad key", bytes: new Uint8Array(32).fill(12) },
    ])
      expect(() => createAgentGuardianObservationServiceV1({ ...options, receiptKey })).toThrow();
  });
  it("binds the exact receipt UUID, site, Event hash, persisted recording time and key under a separate domain", () => {
    const body: NpGuardianRequestSourceReceiptBodyV1 = {
      schemaVersion: NP_GUARDIAN_REQUEST_SOURCE_RECEIPT_SCHEMA_V1,
      receiptId: "73111111-1111-4111-8111-111111111111",
      keyId: "receipt-1",
      siteId: "default",
      eventId: "73111111-1111-4111-8111-111111111112",
      eventHash: `cj1:sha256:${"A".repeat(43)}`,
      recordedAt: "2026-10-17T10:01:00.000Z",
    };
    const bytes = new Uint8Array(32).fill(12);
    const receipt = { ...body, sourceMac: npGuardianRequestSourceMacV1(body, bytes) };
    expect(receipt.sourceMac).toBe("hmac-sha256:fAPe7bZ7e2p5au434w3-uLvKb-15gXzwbhU4c_CqC70");
    expect(npRequireGuardianRequestSourceReceiptV1(receipt)).toEqual(receipt);
    expect(npVerifyGuardianRequestSourceMacV1(receipt, bytes)).toBe(true);
    expect(npVerifyGuardianRequestSourceMacV1(receipt, new Uint8Array(32).fill(13))).toBe(false);
    for (const changed of [
      { ...receipt, receiptId: body.eventId },
      { ...receipt, siteId: "other" },
      { ...receipt, keyId: "receipt-2" },
      { ...receipt, eventId: body.receiptId },
      { ...receipt, eventHash: `cj1:sha256:${"B".repeat(42)}A` },
      { ...receipt, recordedAt: "2026-10-17T10:01:00.001Z" },
    ])
      expect(npVerifyGuardianRequestSourceMacV1(changed, bytes)).toBe(false);
    expect(() =>
      npRequireGuardianRequestSourceReceiptV1({ ...receipt, rawNetwork: "192.0.2.1" }),
    ).toThrow();
    expect(() =>
      npRequireGuardianRequestSourceReceiptV1({ ...receipt, sourceMac: "unkeyed-hash" }),
    ).toThrow();
  });
  it("admits only four in-flight observations and releases capacity after failure", async () => {
    let release: (installed: boolean) => void = () => {};
    const installation = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const isInstalledSite = vi.fn(() => installation);
    const record = vi.fn(() => Promise.reject(new Error("Uninstalled source must not write")));
    const service = createAgentGuardianObservationServiceV1({
      actorKey: { id: "test-key", bytes: new Uint8Array(32).fill(12) },
      isInstalledSite,
      authorize: () => Promise.resolve(),
      events: { record },
    });
    const source = {
      siteId: "default",
      observationId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
      occurredAt: new Date().toISOString(),
      networkAddress: "192.0.2.1",
      kind: "login-failed" as const,
      audience: "staff" as const,
      loginIdentifier: "private@example.test",
    };
    const pending = Array.from({ length: 4 }, () => service.observe(source));
    await vi.waitFor(() => expect(isInstalledSite).toHaveBeenCalledTimes(4));
    await expect(service.observe(source)).rejects.toMatchObject({
      code: "GUARDIAN_OBSERVATION_UNAVAILABLE",
    });
    expect(isInstalledSite).toHaveBeenCalledTimes(4);
    release(false);
    expect(
      (await Promise.allSettled(pending)).every((result) => result.status === "rejected"),
    ).toBe(true);
    await expect(service.observe(source)).rejects.toMatchObject({
      code: "GUARDIAN_OBSERVATION_UNAVAILABLE",
    });
    expect(isInstalledSite).toHaveBeenCalledTimes(5);
    expect(record).not.toHaveBeenCalled();
  });
});

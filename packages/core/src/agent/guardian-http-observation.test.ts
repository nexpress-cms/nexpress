import { describe, expect, it, vi } from "vitest";
import * as database from "../db/runtime.js";
import { createAgentGuardianHttpObservationServiceV1 } from "./guardian-http-observation.js";
function fixture(isInstalledSite = vi.fn(() => Promise.resolve(false))) {
  const record =
    vi.fn<Parameters<typeof createAgentGuardianHttpObservationServiceV1>[0]["events"]["record"]>();
  const authorize = vi.fn(async () => {});
  const source = createAgentGuardianHttpObservationServiceV1({
    actorKey: { id: "http-actor-1", bytes: new Uint8Array(32).fill(91) },
    receiptKey: { id: "http-receipt-1", bytes: new Uint8Array(32).fill(92) },
    isInstalledSite,
    authorize,
    events: { record },
  });
  const input = {
    siteId: "default",
    observationId: "00000000-0000-4000-8000-000000000001",
    occurredAt: new Date().toISOString(),
    status: 404 as const,
    routeFamily: "admin" as const,
    networkAddress: "192.0.2.91",
  };
  return { source, record, authorize, input, isInstalledSite };
}
describe("explicit Guardian final HTTP response source", () => {
  it("constructs and skips a noninstalled site without database or Runtime work", async () => {
    const db = vi.spyOn(database, "getDb");
    try {
      const f = fixture();
      expect(await f.source.observe(f.input)).toEqual({
        disposition: "disabled",
        eventId: null,
        incidentId: null,
      });
      expect(db).not.toHaveBeenCalled();
      expect(f.record).not.toHaveBeenCalled();
      expect(f.authorize).not.toHaveBeenCalled();
    } finally {
      db.mockRestore();
    }
  });
  it("rejects untrusted fields, invalid network and unsupported status before host lookup", async () => {
    const f = fixture();
    for (const patch of [
      { status: 402 },
      { networkAddress: "private.invalid" },
      { path: "/private?secret=x" },
      { userId: "private" },
      { routeFamily: "unknown" },
    ])
      await expect(
        f.source.observe({ ...f.input, ...patch } as typeof f.input),
      ).rejects.toBeDefined();
    expect(f.isInstalledSite).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });
  it("bounds concurrent host probes without entering the database", async () => {
    let release: ((value: boolean) => void) | undefined;
    const held = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const f = fixture(vi.fn(() => held));
    const pending = Array.from({ length: 4 }, () => f.source.observe(f.input));
    await expect(f.source.observe(f.input)).rejects.toMatchObject({
      code: "GUARDIAN_HTTP_SOURCE_BUSY",
    });
    release?.(false);
    await Promise.all(pending);
    expect(f.isInstalledSite).toHaveBeenCalledTimes(4);
    expect(f.record).not.toHaveBeenCalled();
  });
  it("times out a stalled host probe without a late database continuation", async () => {
    let release: ((value: boolean) => void) | undefined;
    const held = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const f = fixture(vi.fn(() => held));
    const db = vi.spyOn(database, "getDb");
    try {
      await expect(f.source.observe(f.input)).rejects.toMatchObject({
        code: "GUARDIAN_HTTP_SOURCE_TIMEOUT",
      });
      release?.(true);
      await Promise.resolve();
      expect(db).not.toHaveBeenCalled();
      expect(f.record).not.toHaveBeenCalled();
    } finally {
      db.mockRestore();
    }
  });
});

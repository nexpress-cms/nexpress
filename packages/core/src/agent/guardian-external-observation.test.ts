import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAgentGuardianExternalObservationServiceV1 } from "./guardian-external-observation.js";
const id = "00000000-0000-4000-8000-000000000001";
function fixture(installed: (siteId: string) => Promise<boolean> = () => Promise.resolve(false)) {
  const signatureKey = new Uint8Array(32).fill(12);
  const record =
    vi.fn<
      Parameters<typeof createAgentGuardianExternalObservationServiceV1>[0]["events"]["record"]
    >();
  const source = createAgentGuardianExternalObservationServiceV1({
    binding: { id, siteId: "default", installationId: id, projectId: "12" },
    signatureKeys: [{ id: "sentry-signing-1", bytes: signatureKey }],
    receiptKey: { id: "host-receipt-1", bytes: new Uint8Array(32).fill(13) },
    isInstalledSite: installed,
    authorize: async () => {},
    events: { record },
    now: () => new Date("2026-10-18T00:00:01.000Z"),
  });
  const rawBody = new TextEncoder().encode(
    JSON.stringify({
      action: "created",
      installation: { uuid: id },
      data: {
        issue: {
          id: "14",
          project: { id: "12" },
          issueCategory: "error",
          firstSeen: "2026-10-18T00:00:00.000Z",
        },
      },
    }),
  );
  const input = {
    rawBody,
    signature: createHmac("sha256", signatureKey).update(rawBody).digest("hex"),
    resource: "issue",
    signal: new AbortController().signal,
  };
  return { source, input, record };
}
describe("explicit external Guardian source installation", () => {
  it("rejects invalid signatures before site resolution, database or Event recording", async () => {
    const installed = vi.fn(() => Promise.resolve(false));
    const f = fixture(installed);
    await expect(f.source.ingest({ ...f.input, signature: "f".repeat(64) })).rejects.toMatchObject({
      code: "GUARDIAN_EXTERNAL_SIGNATURE_INVALID",
    });
    expect(installed).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });
  it("does not initialize a database or record facts when the host site is disabled", async () => {
    const f = fixture();
    expect(await f.source.ingest(f.input)).toEqual({
      disposition: "ignored",
      code: "SOURCE_DISABLED",
      eventId: null,
      incidentId: null,
    });
    expect(f.record).not.toHaveBeenCalled();
  });
  it("bounds concurrent authenticated observation work before acquiring a database", async () => {
    let release: ((value: boolean) => void) | undefined;
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const installed = vi.fn(() => pending);
    const f = fixture(installed);
    const accepted = Array.from({ length: 4 }, () => f.source.ingest(f.input));
    await expect(f.source.ingest(f.input)).rejects.toMatchObject({
      code: "GUARDIAN_EXTERNAL_SOURCE_BUSY",
    });
    expect(installed).toHaveBeenCalledTimes(4);
    release?.(false);
    await Promise.all(accepted);
    expect((await f.source.ingest(f.input)).code).toBe("SOURCE_DISABLED");
  });
});

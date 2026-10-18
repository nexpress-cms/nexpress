import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { NpCollectionMutationObservationV1 } from "../collections/mutation-observer.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAgentContentReceipts } from "../db/schema/guardian.js";
import { createAgentGuardianContentObservationServiceV1 } from "./guardian-content-observation.js";

const runtime = vi.hoisted(() => ({ lock: vi.fn() }));
const capture = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./guardian-capture-admission.js", () => ({
  npReadAgentGuardianCaptureAdmissionV1: capture.read,
}));
vi.mock("./runtime-controls.js", () => ({ npWithAgentRuntimeControlTransactionV1: runtime.lock }));
const id = "00000000-0000-4000-8000-000000000001";
const revisionId = "00000000-0000-4000-8000-000000000002";
function fixture() {
  capture.read.mockResolvedValue({ state: "enabled-by-registration" });
  const inserted: Record<string, unknown>[] = [];
  const values = vi.fn((value: Record<string, unknown>) => {
    inserted.push(value);
    return Promise.resolve();
  });
  const insert = vi.fn(() => ({ values }));
  const db = { insert } as unknown as NpCollectionMutationObservationV1["db"];
  const authorize = vi.fn(async () => {});
  const record =
    vi.fn<
      Parameters<typeof createAgentGuardianContentObservationServiceV1>[0]["events"]["record"]
    >();
  const resolveReceiptKey = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(2)));
  const now = vi.fn(() => new Date("2026-10-18T10:01:00.000Z"));
  const receiptKey = { id: "copied-key", bytes: new Uint8Array(32).fill(1) };
  const installedSiteIds = ["default"];
  const options = {
    receiptKey,
    installedSiteIds,
    authorize,
    events: { record },
    resolveReceiptKey,
    now,
  };
  const service = createAgentGuardianContentObservationServiceV1(options);
  const input: NpCollectionMutationObservationV1 = {
    db,
    siteId: "default",
    collection: "posts",
    documentId: id,
    writeId: id,
    occurredAt: new Date("2026-10-18T10:00:01.000Z"),
    actor: { kind: "staff", userId: id },
    fact: {
      kind: "document-save",
      operation: "update",
      status: "draft",
      revision: {
        id: revisionId,
        version: 2,
        status: "draft",
        createdAt: new Date("2026-10-18T10:00:00.000Z"),
      },
    },
  };
  return {
    service,
    options,
    input,
    insert,
    values,
    inserted,
    authorize,
    record,
    resolveReceiptKey,
    now,
  };
}
describe("Guardian content source-only receipt capture", () => {
  it("skips capture during intentional disable without taking locks or creating receipts", async () => {
    const f = fixture();
    capture.read.mockResolvedValue({ state: "disabled" });
    await f.service.mutationObserver.record(f.input);
    expect(capture.read).toHaveBeenCalledWith(f.input.db, "default");
    expect(f.insert).not.toHaveBeenCalled();
    expect(runtime.lock).not.toHaveBeenCalled();
  });
  it("requires explicit valid key material and a bounded installed-site catalog", () => {
    const f = fixture();
    for (const receiptKey of [
      { id: "bad key", bytes: new Uint8Array(32) },
      { id: "short", bytes: new Uint8Array(31) },
    ])
      expect(() =>
        createAgentGuardianContentObservationServiceV1({ ...f.options, receiptKey }),
      ).toThrow();
    expect(() =>
      createAgentGuardianContentObservationServiceV1({
        ...f.options,
        installedSiteIds: ["WrongSite"],
      }),
    ).toThrow();
    expect(f.insert).not.toHaveBeenCalled();
  });

  it("inserts exactly one immutable metadata receipt using the supplied transaction only", async () => {
    const f = fixture();
    await f.service.mutationObserver.record(f.input);
    expect(f.insert).toHaveBeenCalledExactlyOnceWith(npAgentContentReceipts);
    expect(f.values).toHaveBeenCalledOnce();
    expect(f.inserted[0]).toMatchObject({
      id,
      siteId: "default",
      keyId: "copied-key",
      state: "pending",
      body: {
        schemaVersion: "np.agent-guardian-content-activity.v1",
        writeId: id,
        occurredAt: "2026-10-18T10:00:01.000Z",
        actor: { kind: "staff", userId: id },
        fact: {
          kind: "document-save",
          revision: { id: revisionId, createdAt: "2026-10-18T10:00:00.000Z" },
        },
      },
    });
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
    expect(f.resolveReceiptKey).not.toHaveBeenCalled();
    expect(f.now).not.toHaveBeenCalled();
    expect(runtime.lock).not.toHaveBeenCalled();
  });

  it("copies installation and signing bytes rather than following later host mutation", async () => {
    const f = fixture();
    f.options.installedSiteIds.push("later-site");
    f.options.receiptKey.bytes.fill(9);
    f.options.receiptKey.id = "changed-key";
    await f.service.mutationObserver.record({ ...f.input, siteId: "later-site" });
    expect(f.insert).not.toHaveBeenCalled();
    await f.service.mutationObserver.record(f.input);
    const row = f.inserted[0];
    const bodyHash = `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(row.body)).digest("base64url")}`;
    const expected = `hmac-sha256:${createHmac("sha256", new Uint8Array(32).fill(1))
      .update("np.agent-guardian-content-source.v1")
      .update("\0")
      .update(
        serializeAgentCanonicalJson({
          receiptId: id,
          siteId: "default",
          keyId: "copied-key",
          bodyHash,
          body: row.body,
        }),
      )
      .digest("base64url")}`;
    expect(row.bodyHash).toBe(bodyHash);
    expect(row.sourceMac).toBe(expected);
    expect(row.keyId).toBe("copied-key");
  });

  it("keeps copied Date and actor facts independent of caller mutation", async () => {
    const f = fixture();
    await f.service.mutationObserver.record(f.input);
    f.input.occurredAt.setFullYear(2030);
    if (f.input.actor.kind === "staff") f.input.actor.userId = revisionId;
    if (f.input.fact.revision) f.input.fact.revision.createdAt.setFullYear(2030);
    expect(f.inserted[0].body).toMatchObject({
      occurredAt: "2026-10-18T10:00:01.000Z",
      actor: { userId: id },
      fact: { revision: { createdAt: "2026-10-18T10:00:00.000Z" } },
    });
  });

  it("keeps versions-off saves honest and accepts only actual autosave revision facts", async () => {
    const f = fixture();
    await f.service.mutationObserver.record({
      ...f.input,
      fact: { kind: "document-save", operation: "create", status: "published", revision: null },
    });
    expect(f.inserted[0].body).toMatchObject({ fact: { revision: null } });
    const revision = f.input.fact.revision;
    if (!revision) throw new Error("Expected revision fixture");
    await f.service.mutationObserver.record({
      ...f.input,
      fact: { kind: "revision-autosave", revision: { ...revision, status: "autosave" } },
    });
    expect(f.inserted[1].body).toMatchObject({
      fact: { kind: "revision-autosave", revision: { status: "autosave" } },
    });
    await expect(
      Reflect.apply(f.service.mutationObserver.record.bind(f.service.mutationObserver), undefined, [
        { ...f.input, fact: { ...f.input.fact, revision: { ...revision, status: "autosave" } } },
      ]),
    ).rejects.toThrow();
    expect(f.values).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid dates and extra content fields before inserting a source fact", async () => {
    const f = fixture();
    await expect(
      f.service.mutationObserver.record({ ...f.input, occurredAt: new Date(NaN) }),
    ).rejects.toThrow();
    await expect(
      f.service.mutationObserver.record({
        ...f.input,
        occurredAt: new Date("2026-10-18T09:00:00.000Z"),
      }),
    ).rejects.toThrow();
    await expect(
      Reflect.apply(f.service.mutationObserver.record.bind(f.service.mutationObserver), undefined, [
        { ...f.input, fact: { ...f.input.fact, snapshot: { secret: "never persist this" } } },
      ]),
    ).rejects.toThrow();
    expect(f.insert).not.toHaveBeenCalled();
  });

  it("propagates a receipt write failure so the content transaction can roll back", async () => {
    const f = fixture();
    f.values.mockRejectedValueOnce(new Error("receipt storage unavailable"));
    await expect(f.service.mutationObserver.record(f.input)).rejects.toThrow(
      "receipt storage unavailable",
    );
    expect(f.record).not.toHaveBeenCalled();
  });

  it("rejects uninstalled collection and oversized batches before acquiring Runtime locks", async () => {
    const f = fixture();
    for (const limit of [0, 26, 1.5])
      await expect(f.service.collect({ siteId: "default", limit })).rejects.toThrow();
    await expect(f.service.collect({ siteId: "uninstalled" })).rejects.toThrow();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(runtime.lock).not.toHaveBeenCalled();
  });
});

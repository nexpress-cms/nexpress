import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { batchSiteBuildPreviewObservationsV1 } from "./generator-observation-batches.js";
import type { NpSiteBuildGeneratorObservationEvidenceV1 } from "./generator-evidence.js";

describe("bounded capture observation batches", () => {
  it("preserves all 800 records for 200 routes in deterministic envelopes and every producer lease", async () => {
    const inputs: NpSiteBuildGeneratorObservationEvidenceV1[] = Array.from(
      { length: 400 },
      (_, index) =>
        (["final-preview-audit", "seed-receipt"] as const).map((kind) => ({
          kind,
          name: `page-${index}`,
          bytes: Buffer.from(`{ "capture": ${index}, "kind": "${kind}" }\n`),
          assertUnchanged: vi.fn(async () => {}),
        })),
    ).flat();
    const batched = await batchSiteBuildPreviewObservationsV1(inputs);
    expect(batched.length).toBeLessThan(32);
    expect(batched.every((item) => item.bytes.length <= 8 * 1024 * 1024)).toBe(true);
    const records = batched.flatMap(
      (item) => JSON.parse(Buffer.from(item.bytes).toString()).segments,
    );
    expect(records).toHaveLength(800);
    for (const [index, entry] of records.entries()) {
      expect(entry).toMatchObject({
        kind: inputs[index].kind,
        name: inputs[index].name,
        offset: 0,
        bytes: inputs[index].bytes.length,
      });
      expect(Buffer.from(entry.base64url, "base64url")).toEqual(inputs[index].bytes);
      expect(entry.sha256).toBe(createHash("sha256").update(inputs[index].bytes).digest("hex"));
    }
    const again = await batchSiteBuildPreviewObservationsV1(inputs);
    expect(again.map((item) => item.bytes)).toEqual(batched.map((item) => item.bytes));
    for (const input of inputs) vi.mocked(input.assertUnchanged).mockClear();
    expect(new Set(batched.map((batch) => batch.assertUnchanged)).size).toBe(1);
    await batched[0].assertUnchanged();
    for (const input of inputs) expect(input.assertUnchanged).toHaveBeenCalledOnce();
    vi.mocked(inputs.at(-1)!.assertUnchanged).mockRejectedValue(new Error("producer drift"));
    await expect(batched.at(-1)!.assertUnchanged()).rejects.toThrow("producer drift");
  });

  it("checks each identical producer function once while retaining drift checks for every original buffer", async () => {
    const producer = vi.fn(async () => {});
    const inputs = Array.from({ length: 400 }, (_, index) => ({
      kind: "final-preview-audit" as const,
      name: `page-${index}`,
      bytes: Buffer.from(JSON.stringify({ index })),
      assertUnchanged: producer,
    }));
    const batches = await batchSiteBuildPreviewObservationsV1(inputs);
    expect(producer).toHaveBeenCalledOnce();
    expect(batches.length).toBeGreaterThan(1);
    expect(new Set(batches.map((batch) => batch.assertUnchanged)).size).toBe(1);
    producer.mockClear();
    await batches[0].assertUnchanged();
    expect(producer).toHaveBeenCalledOnce();
    inputs.at(-1)!.bytes[0] = 32;
    await expect(batches[0].assertUnchanged()).rejects.toMatchObject({ reason: "conflict" });
    inputs.at(-1)!.bytes[0] = 123;
    inputs[0].bytes[0] = 32;
    await expect(batches.at(-1)!.assertUnchanged()).rejects.toMatchObject({ reason: "conflict" });
  });

  it("segments exact large observation bytes without widening string or envelope bounds", async () => {
    const bytes = Buffer.from(
      JSON.stringify({ rows: Array.from({ length: 20 }, () => "x".repeat(400_000)) }),
    );
    const batched = await batchSiteBuildPreviewObservationsV1([
      { kind: "final-preview-audit", name: "page-0", bytes, assertUnchanged: async () => {} },
    ]);
    expect(batched).toHaveLength(2);
    const segments = batched.flatMap(
      (item) => JSON.parse(Buffer.from(item.bytes).toString()).segments,
    );
    let offset = 0;
    for (const segment of segments) {
      expect(segment.offset).toBe(offset);
      expect(segment.base64url.length).toBeLessThan(512 * 1024);
      offset += Buffer.from(segment.base64url, "base64url").length;
    }
    expect(
      Buffer.concat(segments.map((segment) => Buffer.from(segment.base64url, "base64url"))).equals(
        bytes,
      ),
    ).toBe(true);
    bytes[0] = 32;
    await expect(batched[0].assertUnchanged()).rejects.toMatchObject({ reason: "conflict" });
  }, 30_000);

  it("does not conceal malformed original JSON inside base64 or accept duplicate capture identities", async () => {
    const entry = {
      kind: "seed-receipt" as const,
      name: "page-0",
      bytes: Buffer.from('{"a":1,"a":2}'),
      assertUnchanged: async () => {},
    };
    await expect(batchSiteBuildPreviewObservationsV1([entry])).rejects.toThrow();
    entry.bytes = Buffer.from("{}");
    await expect(batchSiteBuildPreviewObservationsV1([entry, entry])).rejects.toMatchObject({
      reason: "input",
    });
  });
});

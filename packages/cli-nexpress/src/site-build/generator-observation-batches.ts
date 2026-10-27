import { createHash } from "node:crypto";
import { npParseBuildCandidateTransportJsonV1 } from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type { NpSiteBuildGeneratorObservationEvidenceV1 } from "./generator-evidence.js";

const MAX_ENVELOPE = 8 * 1024 * 1024;
const CHUNK = 256 * 1024; // Base64 stays below the transport's 512 KiB string bound.
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Segment = {
  kind: "final-preview-audit" | "seed-receipt";
  name: string;
  bytes: number;
  sha256: string;
  offset: number;
  base64url: string;
};

/** Preserve each capture's exact bytes and live lease in deterministic bounded envelopes. */
export async function batchSiteBuildPreviewObservationsV1(
  observations: readonly NpSiteBuildGeneratorObservationEvidenceV1[],
): Promise<NpSiteBuildGeneratorObservationEvidenceV1[]> {
  if (!Array.isArray(observations) || observations.length > 800) throw new SiteBuildError("input");
  const batches: NpSiteBuildGeneratorObservationEvidenceV1[] = [];
  const names = new Set<string>();
  const producers = new Set<() => Promise<void>>();
  const originals: Array<{
    observation: NpSiteBuildGeneratorObservationEvidenceV1;
    digest: string;
  }> = [];
  const assertUnchanged = async () => {
    for (const producer of producers) await producer();
    for (const { observation, digest } of originals)
      if (sha(observation.bytes) !== digest) throw new SiteBuildError("conflict");
  };
  let segments: Segment[] = [];
  let total = 0;
  const encode = (entries: Segment[]) =>
    Buffer.from(
      JSON.stringify({ schemaVersion: "np.site-build-observation-batch.v1", segments: entries }),
    );
  const emptyBytes = encode([]).length;
  let envelopeBytes = emptyBytes;
  const flush = () => {
    if (!segments.length) return;
    const bytes = encode(segments);
    if (bytes.length > MAX_ENVELOPE || (total += bytes.length) > 252 * 1024 * 1024)
      throw new SiteBuildError("input");
    npParseBuildCandidateTransportJsonV1(bytes.toString("utf8"));
    batches.push({
      kind: "final-preview-audit",
      name: `batch-${String(batches.length).padStart(3, "0")}`,
      bytes,
      assertUnchanged,
    });
    segments = [];
    envelopeBytes = emptyBytes;
  };
  for (const observation of observations) {
    if (
      (observation.kind !== "final-preview-audit" && observation.kind !== "seed-receipt") ||
      !/^page-\d{1,3}$/u.test(observation.name) ||
      typeof observation.assertUnchanged !== "function" ||
      !(observation.bytes instanceof Uint8Array) ||
      observation.bytes.length < 1 ||
      observation.bytes.length > MAX_ENVELOPE
    )
      throw new SiteBuildError("input");
    const identity = `${observation.kind}/${observation.name}`;
    if (names.has(identity)) throw new SiteBuildError("input");
    names.add(identity);
    if (!producers.has(observation.assertUnchanged)) {
      await observation.assertUnchanged();
      producers.add(observation.assertUnchanged);
    }
    const bytes = Buffer.from(observation.bytes),
      digest = sha(bytes);
    npParseBuildCandidateTransportJsonV1(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    originals.push({ observation, digest });
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      const segment: Segment = {
        kind: observation.kind,
        name: observation.name,
        bytes: bytes.length,
        sha256: digest,
        offset,
        base64url: bytes.subarray(offset, offset + CHUNK).toString("base64url"),
      };
      const segmentBytes = Buffer.byteLength(JSON.stringify(segment));
      if (
        segments.length >= 128 ||
        envelopeBytes + segmentBytes + (segments.length ? 1 : 0) > MAX_ENVELOPE
      )
        flush();
      envelopeBytes += segmentBytes + (segments.length ? 1 : 0);
      segments.push(segment);
    }
  }
  flush();
  return batches;
}

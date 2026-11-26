import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { canonicalBodySiteId } from "../agent-contract/canonical-body-validation.js";
import type { NpAgentActorBucketRefV1 } from "../agent-contract/types.js";

/** Frozen observation-v1 bytes. Changing normalization or framing requires a new projection. */
export const NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1 = `cj1:sha256:${createHash("sha256")
  .update(
    serializeAgentCanonicalJson({
      schemaVersion: "np.agent-guardian-actor-projection.v1",
      algorithm: "hmac-sha256",
      normalization: "canonical-ip-or-trimmed-lowercase-login",
      version: 1,
    }),
  )
  .digest("base64url")}`;

export function npNormalizeAgentGuardianNetworkAddressV1(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 || !isIP(value))
    throw new Error("Invalid Guardian network projection input.");
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}

export interface NpAgentGuardianActorProjectionV1 {
  readonly projectionVersion: 1;
  readonly projectionFingerprint: string;
  readonly keyId: string;
  project(input: {
    siteId: string;
    purpose: NpAgentActorBucketRefV1["purpose"];
    value: string;
  }): NpAgentActorBucketRefV1;
}

/** Host-owned copied key material; never loads credentials or retains the raw subject. */
export function createAgentGuardianActorProjectionV1(actorKey: {
  id: string;
  bytes: Uint8Array;
}): NpAgentGuardianActorProjectionV1 {
  if (
    !actorKey ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(actorKey.id) ||
    !(actorKey.bytes instanceof Uint8Array) ||
    actorKey.bytes.length < 32 ||
    actorKey.bytes.length > 64
  )
    throw new Error("Invalid Guardian actor projection installation.");
  const key = new Uint8Array(actorKey.bytes);
  const keyId = actorKey.id;
  const projectionFingerprint = NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1;
  return Object.freeze({
    projectionVersion: 1,
    projectionFingerprint,
    keyId,
    project({
      siteId,
      purpose,
      value,
    }: Parameters<NpAgentGuardianActorProjectionV1["project"]>[0]) {
      canonicalBodySiteId(siteId, "guardian.projection.siteId");
      if (purpose !== "network-address" && purpose !== "login-identifier")
        throw new Error("Invalid Guardian actor projection purpose.");
      if (typeof value !== "string" || value.length > 1024 || !value.trim())
        throw new Error("Invalid Guardian actor projection input.");
      const normalized =
        purpose === "network-address"
          ? npNormalizeAgentGuardianNetworkAddressV1(value)
          : value.trim().toLowerCase();
      return {
        purpose,
        projectionVersion: 1,
        projectionFingerprint,
        keyId,
        bucket: createHmac("sha256", key)
          .update(
            serializeAgentCanonicalJson({
              domain: "np.agent-guardian-actor.v1",
              siteId,
              purpose,
              projectionFingerprint,
              keyId,
              value: normalized,
            }),
          )
          .digest("base64url"),
      };
    },
  });
}

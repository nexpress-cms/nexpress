import { describe, expect, it } from "vitest";
import {
  createAgentGuardianActorProjectionV1,
  NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1,
} from "./guardian-actor-projection.js";

describe("frozen Guardian actor projection", () => {
  it("preserves observation-v1 bytes, canonical IPv6 and copied key material", () => {
    const bytes = new Uint8Array(32).fill(7);
    const projection = createAgentGuardianActorProjectionV1({ id: "key-1", bytes });
    bytes.fill(0);
    const first = projection.project({
      siteId: "default",
      purpose: "network-address",
      value: "2001:0db8:0:0:0:0:0:1",
    });
    expect(first).toEqual(
      projection.project({ siteId: "default", purpose: "network-address", value: "2001:db8::1" }),
    );
    expect(first.projectionFingerprint).toBe(NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1);
    expect(first.bucket).toBe("7Aam94-bVHOKtGALSZlyqfPuozFgEji2NM1Dx3jIw3k");
    expect(JSON.stringify(first)).not.toContain("2001:db8");
  });

  it("separates sites, purposes and frozen key ids and rejects invalid input", () => {
    const project = createAgentGuardianActorProjectionV1({
      id: "key-1",
      bytes: new Uint8Array(32).fill(7),
    });
    const network = project.project({
      siteId: "default",
      purpose: "network-address",
      value: "203.0.113.1",
    });
    expect(network.bucket).not.toBe(
      project.project({ siteId: "another-site", purpose: "network-address", value: "203.0.113.1" })
        .bucket,
    );
    expect(network.bucket).not.toBe(
      project.project({ siteId: "default", purpose: "login-identifier", value: "203.0.113.1" })
        .bucket,
    );
    expect(
      project.project({
        siteId: "default",
        purpose: "login-identifier",
        value: " PERSON@EXAMPLE.TEST ",
      }),
    ).toEqual(
      project.project({
        siteId: "default",
        purpose: "login-identifier",
        value: "person@example.test",
      }),
    );
    expect(() =>
      project.project({
        siteId: "default",
        purpose: "network-address",
        value: "private@example.test",
      }),
    ).toThrow();
    expect(() =>
      createAgentGuardianActorProjectionV1({ id: "bad key", bytes: new Uint8Array(32) }),
    ).toThrow();
  });
});

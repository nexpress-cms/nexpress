import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { npCollectAgentGuardianHealthV1 } from "../../../packages/core/src/agent/guardian-health.js";
import { createAgentGuardianControlsV1 } from "../../../packages/core/src/agent/guardian-controls.js";
import { npAgentGuardianOperationsSourceIdsV1 } from "../../../packages/core/src/agent-contract/guardian-operations-contract.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
const hash = `cj1:sha256:${createHash("sha256").update("guardian-health-fixture").digest("base64url")}`;
describe.skipIf(skipIfNoTestDb())("Guardian preboot/live aggregate health", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("uses the existing DB for bounded aggregate reads without inventing proof-key readiness", async () => {
    const f = await fixture(),
      result = await npCollectAgentGuardianHealthV1({ db: f.db });
    expect(result.state).toBe("warn");
    expect(result.controls.sampledSites).toBeGreaterThan(0);
    expect(result.recentSignals.sampled).toBe(0);
    expect(result.proofs.every((p) => p.coverage === "unavailable" && p.verified === null)).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain(siteId);
  });
  it("distinguishes a valid local disable from unconfigured sites", async () => {
    const f = await fixture(),
      controls = createAgentGuardianControlsV1({ deploymentActorFingerprint: hash });
    expect((await controls.disable({ siteId, reason: "Contain" })).outcome).toBe("disabled");
    const result = await npCollectAgentGuardianHealthV1({ db: f.db });
    expect(result.controls.disabled).toBe(1);
    expect(result.controls.invalid).toBe(0);
    expect(result.controls.unconfigured).toBeGreaterThan(0);
  });
  it("marks malformed persisted control evidence as blocking", async () => {
    const f = await fixture();
    await f.db
      .insert(npSettings)
      .values({ siteId, key: "guardian.control", value: { enabled: false } });
    const result = await npCollectAgentGuardianHealthV1({ db: f.db });
    expect(result.state).toBe("error");
    expect(result.controls.invalid).toBe(1);
    expect(result.controls.disabled).toBe(0);
  });
  it("binds array parameters correctly for explicit live proof owners and keeps empty coverage bounded", async () => {
    const f = await fixture(),
      verifyEvent = vi.fn(async () => {
        throw new Error("No retained source Events exist");
      });
    const proofOwners = npAgentGuardianOperationsSourceIdsV1.map((source) => ({
      source,
      readiness: async () => "ready" as const,
      verifyEvent,
    }));
    const result = await npCollectAgentGuardianHealthV1({ db: f.db, proofOwners });
    expect(result.state).toBe("ok");
    expect(
      result.proofs.every((p) => p.coverage === "verified" && p.sampled === 0 && p.verified === 0),
    ).toBe(true);
    expect(verifyEvent).not.toHaveBeenCalled();
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npAgentActions, npAgentEvents } from "../../../packages/core/src/db/schema/agent.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import { guardianSessionFixture } from "./agent-guardian-session-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Guardian exact-session retained verification evidence", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("retains expired dispatched revocation events while Action and audit evidence still references them", async () => {
    const f = await guardianSessionFixture();
    const plan = await f.plan();
    await f.decide(plan.approval.id);
    await f.service.execute({ ...f.input, command: plan.execute });
    const [action] = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.id, plan.result.resourceId));
    const receipt = action.verificationEvidence?.[0];
    if (!receipt || typeof receipt.eventId !== "string")
      throw new Error("Expected actual revocation event reference");
    const expires = new Date(f.now().getTime() + 1);
    await f.db
      .update(npAgentEvents)
      .set({ expiresAt: expires, dispatchedAt: f.now() })
      .where(eq(npAgentEvents.id, receipt.eventId));
    const result = await pruneAgentRuntimeEventsV1({
      siteId: f.input.siteId,
      now: new Date(f.now().getTime() + 400 * 86400000),
      limit: 100,
    });
    expect(result.examined).toBeGreaterThanOrEqual(1);
    const [event] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.id, receipt.eventId));
    expect(event).toMatchObject({ kind: "auth.session.revoked", eventHash: receipt.eventHash });
    const current = await f.service.get(f.input);
    expect(current.plans.find((p) => p.actionId === action.id)).toMatchObject({
      state: "succeeded",
      canExecute: false,
    });
    expect(current.canPlan).toBe(false);
  });
});

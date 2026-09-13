import { describe, expect, it, vi } from "vitest";
import {
  createAgentRuntimeExecutorV1,
  type NpAgentRuntimeExecutorOptionsV1,
} from "./runtime-executor.js";

const identity = { siteId: "default", runId: "00000000-0000-4000-8000-000000000001" };
const requestActionId = "00000000-0000-4000-8000-000000000002";
const claim = { attempt: 2, leaseUntil: "2026-09-12T00:01:00.000Z" };
function fixture(status: "pending" | "ready" | "unresolved" = "ready") {
  const receipt = { status, requestActionId, executionActionId: null, executionSequence: null };
  const select = vi.fn(() => {
    let ordered = false;
    const query = {
      from: () => query,
      where: () => query,
      orderBy: () => {
        ordered = true;
        return query;
      },
      limit: vi.fn(() =>
        Promise.resolve(
          ordered ? [] : [{ id: requestActionId, state: "approval_pending", sequence: 3 }],
        ),
      ),
    };
    return query;
  });
  const context = {
    db: { select },
    siteId: identity.siteId,
    run: { id: identity.runId },
    limits: { maxProviderCalls: 10 },
  };
  const store = {
    claim: vi.fn().mockResolvedValue({ state: "waiting_approval", claim: null }),
    renew: vi.fn().mockResolvedValue(claim),
    claimApproval: vi.fn().mockResolvedValue({ state: "running", claim }),
    withClaim: vi.fn((_input, operation) => Promise.resolve(operation(context))),
    transition: vi.fn((input) => Promise.resolve({ state: input.state })),
    cancel: vi.fn().mockResolvedValue({ state: "cancelled" }),
  };
  const capabilities = {
    inspectRuntimeApproval: vi.fn().mockResolvedValue(receipt),
    resumeRuntimeApproval: vi.fn().mockResolvedValue({}),
  };
  const provider = { invoke: vi.fn() };
  const executor = createAgentRuntimeExecutorV1({
    store,
    capabilities,
    provider,
  } as unknown as NpAgentRuntimeExecutorOptionsV1);
  return { executor, store, capabilities, provider, receipt };
}
describe("explicit Runtime approval continuation", () => {
  it("ordinary processing leaves waiting approval without invoking a provider", async () => {
    const f = fixture();
    await expect(f.executor.process(identity)).resolves.toEqual({ state: "waiting_approval" });
    expect(f.provider.invoke).not.toHaveBeenCalled();
    expect(f.capabilities.resumeRuntimeApproval).not.toHaveBeenCalled();
  });
  it("ordinary recovery retains an unresolved approved execution as verifying", async () => {
    const f = fixture("unresolved");
    f.store.claim.mockResolvedValue({ state: "running", claim });
    await expect(f.executor.process(identity)).resolves.toEqual({ state: "verifying" });
    expect(f.provider.invoke).not.toHaveBeenCalled();
    expect(f.capabilities.resumeRuntimeApproval).not.toHaveBeenCalled();
  });
  it("does not resume without the store's verified approval claim", async () => {
    const f = fixture("pending");
    f.store.claimApproval.mockResolvedValue({ state: "waiting_approval", claim: null });
    await expect(f.executor.resumeApproval({ ...identity, requestActionId })).resolves.toEqual({
      state: "waiting_approval",
    });
    expect(f.capabilities.resumeRuntimeApproval).not.toHaveBeenCalled();
    expect(f.provider.invoke).not.toHaveBeenCalled();
  });
  it("retains unresolved execution as verifying and never asks the provider to replan", async () => {
    const f = fixture("unresolved");
    await expect(f.executor.resumeApproval({ ...identity, requestActionId })).resolves.toEqual({
      state: "verifying",
    });
    expect(f.capabilities.resumeRuntimeApproval).toHaveBeenCalledWith({
      ...identity,
      requestActionId,
      claim,
      sequence: 4,
    });
    expect(f.provider.invoke).not.toHaveBeenCalled();
  });
  it("reuses the verified distinct execution sequence during crash recovery", async () => {
    const f = fixture("unresolved");
    f.capabilities.inspectRuntimeApproval.mockResolvedValue({
      ...f.receipt,
      executionActionId: "00000000-0000-4000-8000-000000000003",
      executionSequence: 4,
    });
    await f.executor.resumeApproval({ ...identity, requestActionId });
    expect(f.capabilities.resumeRuntimeApproval).toHaveBeenCalledWith({
      ...identity,
      requestActionId,
      claim,
      sequence: 4,
    });
    expect(f.provider.invoke).not.toHaveBeenCalled();
  });
  it("rejects caller authority and malformed action identities before claiming", async () => {
    const f = fixture();
    await expect(
      f.executor.resumeApproval({ ...identity, requestActionId, userId: "forged" } as never),
    ).rejects.toThrow();
    await expect(
      f.executor.resumeApproval({ ...identity, requestActionId: "bad" }),
    ).rejects.toThrow();
    expect(f.store.claimApproval).not.toHaveBeenCalled();
  });
  it("contains an execution error without starting another provider turn", async () => {
    const f = fixture();
    f.capabilities.resumeRuntimeApproval.mockRejectedValue(new Error("unavailable"));
    await expect(f.executor.resumeApproval({ ...identity, requestActionId })).rejects.toThrow();
    expect(f.store.transition).not.toHaveBeenCalled();
    expect(f.provider.invoke).not.toHaveBeenCalled();
  });
});

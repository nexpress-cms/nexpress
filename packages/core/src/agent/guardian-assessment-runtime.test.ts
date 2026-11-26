import { describe, expect, it, vi } from "vitest";
import { npCreateAgentGuardianAssessmentRecipeDefinitionV1 } from "../agent-contract/guardian-assessment-recipe-contract.js";
import type { NpAgentRecipeDefinitionCanonicalV1 } from "../agent-contract/types.js";
import { npIsAgentRuntimeManualRecipeSupportedV1 } from "../agent-contract/runtime-manual-input.js";
import { npRequireAgentGuardianAssessmentRetryV1 } from "./guardian-assessment-context.js";
import { createAgentRuntimeContextV1 } from "./runtime-context.js";
import {
  createAgentRuntimeExecutorV1,
  type NpAgentRuntimeExecutorOptionsV1,
} from "./runtime-executor.js";
import type { NpAgentRuntimeAdmissionV1 } from "./runtime-admission.js";
import {
  guardianAssessmentContextFixture,
  guardianAssessmentUuid,
} from "./guardian-assessment-test-fixture.js";

describe("explicit Guardian Runtime integration", () => {
  it("shares one fail-closed cross-Run retry guard and makes no query for other profiles", async () => {
    const f = await guardianAssessmentContextFixture();
    const calls: { id: string }[] = [];
    const query = { from: () => query, where: () => query, limit: () => Promise.resolve(calls) };
    const select = vi.fn(() => query);
    const context = { ...f.context, db: { select } as unknown as typeof f.context.db };
    await expect(npRequireAgentGuardianAssessmentRetryV1(context)).resolves.toBeUndefined();
    calls.push({ id: guardianAssessmentUuid(41) });
    await expect(npRequireAgentGuardianAssessmentRetryV1(context)).rejects.toMatchObject({
      code: "GUARDIAN_ASSESSMENT_RETRY_UNAVAILABLE",
    });
    const recipe = context.evidence.registry.recipes[0];
    context.evidence.registry.recipes = [{ ...recipe, task: "interactive-capability" }];
    await expect(npRequireAgentGuardianAssessmentRetryV1(context)).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("admits only exact manual Guardian profiles, not a task label or widened source profile", async () => {
    const recipe = await npCreateAgentGuardianAssessmentRecipeDefinitionV1("guardian.agent-abuse");
    expect(npIsAgentRuntimeManualRecipeSupportedV1(recipe)).toBe(true);
    const modifiedProfiles: NpAgentRecipeDefinitionCanonicalV1[] = [
      { ...recipe, triggerKinds: ["event"] },
      { ...recipe, allowedTemplates: ["guardian", "operator"] },
      { ...recipe, capabilityIds: [...recipe.capabilityIds, "security.limitActor"] },
    ];
    for (const modified of modifiedProfiles)
      expect(npIsAgentRuntimeManualRecipeSupportedV1(modified)).toBe(false);
  });

  it.each([false, true])(
    "rejects an absent or copied source facet before any database or provider I/O (copy=%s)",
    async (copied) => {
      const f = await guardianAssessmentContextFixture();
      const read = vi.fn();
      const admission = {
        withCurrentRun: (
          _input: unknown,
          operation: (context: typeof f.context) => Promise<unknown>,
        ) => operation(f.context),
      } as unknown as NpAgentRuntimeAdmissionV1;
      const context = createAgentRuntimeContextV1({
        admission,
        ...(copied ? { guardianAssessmentEvidence: { read } } : {}),
      });
      await expect(
        context.prepare({
          siteId: f.context.siteId,
          runId: f.context.run.id,
          providerCallId: guardianAssessmentUuid(40),
          sequence: 1,
          retryOfId: null,
          idempotencyKey: "guardian-unit",
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE" });
      expect(read).not.toHaveBeenCalled();
      expect(f.select).not.toHaveBeenCalled();
      context.dispose();
    },
  );

  it("requires the explicit Guardian persistence owner before preparing, reserving, leasing or invoking", async () => {
    const f = await guardianAssessmentContextFixture();
    const query = {
      from: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => Promise.resolve([]),
    };
    const current = { ...f.context, db: { select: () => query }, limits: { maxProviderCalls: 2 } };
    const claim = { attempt: 1, leaseUntil: "2026-10-18T00:01:00.000Z" };
    const store = {
      claim: vi.fn().mockResolvedValue({ state: "running", claim }),
      renew: vi.fn().mockResolvedValue(claim),
      withClaim: vi.fn((_input, operation) => Promise.resolve(operation(current))),
      transition: vi.fn((input) => Promise.resolve({ state: input.state })),
    };
    const context = { prepare: vi.fn() },
      usage = { reserve: vi.fn() },
      vault = { leaseProviderCredential: vi.fn() },
      provider = { invoke: vi.fn() };
    const executor = createAgentRuntimeExecutorV1({
      store,
      context,
      usage,
      vault,
      provider,
      breakers: { observeRun: vi.fn() },
    } as unknown as NpAgentRuntimeExecutorOptionsV1);
    await expect(
      executor.process({ siteId: f.context.siteId, runId: f.context.run.id }),
    ).resolves.toEqual({ state: "failed" });
    expect(store.transition).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "RUNTIME_TARGET_ADMISSION_UNAVAILABLE" }),
      undefined,
    );
    for (const effect of [
      context.prepare,
      usage.reserve,
      vault.leaseProviderCredential,
      provider.invoke,
    ])
      expect(effect).not.toHaveBeenCalled();
    executor.shutdown();
  });
});

import * as preview from "./changeset-preview-overlay.js";
import { describe, it, expect, vi } from "vitest";
import { NpAgentConnectionAuthAdapterRegistryV1 } from "./provider-auth-contract.js";
import { createAgentFakeProviderAdapterV1 } from "./provider-fake.js";
import { createAgentProviderInferenceRuntimeV1 } from "./provider-inference.js";
import { providerInput, providerSuccess } from "./provider-inference-fixture.js";

function fixture(invoke = vi.fn().mockResolvedValue(providerSuccess())) {
  const adapter = { ...createAgentFakeProviderAdapterV1(), inference: { invoke } };
  const registry = new NpAgentConnectionAuthAdapterRegistryV1().register(adapter);
  return {
    invoke,
    adapter,
    registry,
    input: providerInput(adapter),
    runtime: createAgentProviderInferenceRuntimeV1({ registry, drainMilliseconds: 10 }),
  };
}
describe("provider inference host", () => {
  it("reuses canonical output and strips journal coordinates from adapter input", async () => {
    const f = fixture();
    const result = await f.runtime.invoke(f.input);
    expect(result.outcome.status).toBe("succeeded");
    expect(result.decision).toEqual(providerSuccess().output);
    const request = f.invoke.mock.calls[0][0];
    expect(request).not.toHaveProperty("siteId");
    expect(request).not.toHaveProperty("providerCallId");
    expect(request).not.toHaveProperty("connection");
    expect(request).not.toHaveProperty("idempotencyKey");
    expect(f.input.isDisposed()).toBe(true);
  });
  it.each(["throw", "schema", "price", "task", "provider", "extra"])(
    "retains ambiguity for %s violations",
    async (mode) => {
      const outcome = providerSuccess();
      if (outcome.status !== "succeeded") throw new Error("fixture");
      if (mode === "schema")
        outcome.output = {
          task: "interactive-capability",
          decision: { kind: "complete", summary: "Done", secret: "not-safe" },
        };
      if (mode === "price") outcome.usage.costMicros++;
      if (mode === "task")
        outcome.output = {
          task: "guardian-assessment",
          decision: { kind: "request-evidence", resource: { kind: "ops-check", checkId: "test" } },
        };
      if (mode === "provider") outcome.provider = "different";
      const f = fixture(
        mode === "throw"
          ? vi.fn().mockRejectedValue(new Error("private exception"))
          : vi
              .fn()
              .mockResolvedValue(mode === "extra" ? { ...outcome, private: "secret" } : outcome),
      );
      const result = await f.runtime.invoke(f.input);
      expect(result.outcome).toMatchObject({
        status: "ambiguous",
        safeCode: "PROVIDER_OUTCOME_UNKNOWN",
        usage: null,
        retryable: false,
      });
      expect(JSON.stringify(result)).not.toContain("private exception");
      expect(f.input.isDisposed()).toBe(true);
    },
  );
  it("does not invoke unavailable, expired or cross-connection leases", async () => {
    for (const mode of ["expired", "connection", "secret"]) {
      const f = fixture();
      if (mode === "expired")
        f.input.credentialLease = {
          ...f.input.credentialLease,
          expiresAt: "2000-01-01T00:00:00.000Z",
        };
      if (mode === "connection") f.input.connection.configVersion++;
      if (mode === "secret")
        f.input.credentialLease = {
          ...f.input.credentialLease,
          secretVersionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd9",
        };
      expect((await f.runtime.invoke(f.input)).outcome).toMatchObject({
        status: "failed",
        dispatchState: "not-dispatched",
      });
      expect(f.invoke).not.toHaveBeenCalled();
    }
  });
  it("aborts hanging calls, disposes leases, contains throwing shutdown and closes admission", async () => {
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const f = fixture(
      vi.fn().mockImplementation(() => {
        dispatched();
        return new Promise(() => undefined);
      }),
    );
    const run = f.runtime.invoke(f.input);
    await started;
    expect(await f.runtime.shutdown()).toEqual({ status: "closed", safeCodes: [] });
    expect((await run).outcome.status).toBe("ambiguous");
    expect(f.input.isDisposed()).toBe(true);
    expect((await f.runtime.invoke(providerInput(f.adapter))).outcome).toMatchObject({
      status: "failed",
      dispatchState: "not-dispatched",
    });
  });
  it("normalizes caller abort without trusting exception classes", async () => {
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const f = fixture(
      vi.fn().mockImplementation(() => {
        dispatched();
        return new Promise(() => undefined);
      }),
    );
    const controller = new AbortController();
    const run = f.runtime.invoke({ ...f.input, signal: controller.signal });
    await started;
    controller.abort();
    expect((await run).outcome.status).toBe("ambiguous");
  });
  it("rejects different adapter implementations with the same claimed fingerprint", () => {
    const f = fixture();
    expect(() =>
      f.registry.register({
        ...f.adapter,
        inference: { invoke: vi.fn().mockResolvedValue(providerSuccess()) },
      }),
    ).toThrow();
    expect(f.registry.register(f.adapter)).toBe(f.registry);
  });
  it("enforces the hard provider deadline even when the adapter ignores abort", async () => {
    const f = fixture(vi.fn().mockImplementation(() => new Promise(() => undefined)));
    f.input.request.limits.timeoutSeconds = 1;
    const result = await f.runtime.invoke(f.input);
    expect(result.outcome).toMatchObject({
      status: "ambiguous",
      safeCode: "PROVIDER_OUTCOME_UNKNOWN",
    });
    expect(f.input.isDisposed()).toBe(true);
  });
  it("contains shutdown failure and rejects malformed inference registration", async () => {
    const adapter = {
      ...createAgentFakeProviderAdapterV1(),
      inference: {
        invoke: vi.fn().mockResolvedValue(providerSuccess()),
        shutdown: vi.fn().mockRejectedValue(new Error("private")),
      },
    };
    const registry = new NpAgentConnectionAuthAdapterRegistryV1().register(adapter);
    expect(await createAgentProviderInferenceRuntimeV1({ registry }).shutdown()).toEqual({
      status: "degraded",
      safeCodes: ["PROVIDER_SHUTDOWN_FAILED"],
    });
    expect(() => registry.register({ ...adapter, inference: { invoke: null as never } })).toThrow();
  });
  it("rejects preview invocation and shutdown before touching a lease or adapter", async () => {
    const f = fixture();
    const guard = vi.spyOn(preview, "npAssertAgentPreviewEffectsAllowed").mockImplementation(() => {
      throw new Error("Effects are unavailable");
    });
    try {
      await expect(f.runtime.invoke(f.input)).rejects.toThrow("Effects are unavailable");
      expect(() => f.runtime.shutdown()).toThrow("Effects are unavailable");
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.input.isDisposed()).toBe(false);
    } finally {
      guard.mockRestore();
    }
  });
});

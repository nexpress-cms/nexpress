import { describe, expect, it, vi } from "vitest";
import { createAgentGuardianObservationServiceV1 } from "./guardian-observation-service.js";

describe("Guardian observation work budget", () => {
  it("admits only four in-flight observations and releases capacity after failure", async () => {
    let release: (installed: boolean) => void = () => {};
    const installation = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const isInstalledSite = vi.fn(() => installation);
    const record = vi.fn(() => Promise.reject(new Error("Uninstalled source must not write")));
    const service = createAgentGuardianObservationServiceV1({
      actorKey: { id: "test-key", bytes: new Uint8Array(32).fill(12) },
      isInstalledSite,
      authorize: () => Promise.resolve(),
      events: { record },
    });
    const source = {
      siteId: "default",
      observationId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
      occurredAt: new Date().toISOString(),
      networkAddress: "192.0.2.1",
      kind: "login-failed" as const,
      audience: "staff" as const,
      loginIdentifier: "private@example.test",
    };
    const pending = Array.from({ length: 4 }, () => service.observe(source));
    expect(isInstalledSite).toHaveBeenCalledTimes(4);
    await expect(service.observe(source)).rejects.toMatchObject({
      code: "GUARDIAN_OBSERVATION_UNAVAILABLE",
    });
    expect(isInstalledSite).toHaveBeenCalledTimes(4);
    release(false);
    expect(
      (await Promise.allSettled(pending)).every((result) => result.status === "rejected"),
    ).toBe(true);
    await expect(service.observe(source)).rejects.toMatchObject({
      code: "GUARDIAN_OBSERVATION_UNAVAILABLE",
    });
    expect(isInstalledSite).toHaveBeenCalledTimes(5);
    expect(record).not.toHaveBeenCalled();
  });
});

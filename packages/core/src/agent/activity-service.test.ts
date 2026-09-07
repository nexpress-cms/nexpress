import { describe, it, expect } from "vitest";
import { createAgentActivityServiceV1 } from "./activity-service.js";
import type { NpAgentAuthenticatedServicePrincipalV1 } from "./gateway-service.js";
describe("Activity host boundary", () => {
  it("refuses weak cursor keys before installing a service", () => {
    for (const length of [0, 16, 31])
      expect(() => createAgentActivityServiceV1({ cursorHmacKey: new Uint8Array(length) })).toThrow(
        "at least 32 bytes",
      );
  });
  it("does not consult a fabricated run or credential when machine admission is absent", async () => {
    const service = createAgentActivityServiceV1({ cursorHmacKey: new Uint8Array(32).fill(5) });
    let inspected = 0;
    const authentication = {
      get principal() {
        inspected++;
        throw new Error("credential must not be inspected");
      },
    } as unknown as NpAgentAuthenticatedServicePrincipalV1;
    for (const runId of ["not-an-id", "11111111-1111-4111-8111-111111111111"])
      await expect(service.getMachineRun({ authentication, runId })).rejects.toMatchObject({
        code: "ACTIVITY_NOT_FOUND",
        status: 404,
        message: "Activity is unavailable.",
      });
    expect(inspected).toBe(0);
  });
});

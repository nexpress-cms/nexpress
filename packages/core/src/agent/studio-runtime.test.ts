import { afterEach, describe, expect, it } from "vitest";

import {
  createAgentStudioServerRuntimeV1,
  getOptionalAgentStudioServerRuntimeV1,
  npAgentStudioRuntimeStatusV1,
  requireAgentStudioConnectionRuntimeV1,
  requireAgentStudioGatewayRuntimeV1,
  resetAgentStudioServerRuntimeV1,
  setAgentStudioServerRuntimeV1,
} from "./studio-runtime.js";

afterEach(() => resetAgentStudioServerRuntimeV1());

describe("Agent Studio host runtime", () => {
  it("stays honestly unavailable with disabled Gateway settings by default", async () => {
    const runtime = createAgentStudioServerRuntimeV1();

    expect(npAgentStudioRuntimeStatusV1(runtime)).toEqual({
      schemaVersion: "np.agent-studio-runtime.v1",
      connections: {
        state: "unavailable",
        issueCode: "AGENT_CONNECTION_RUNTIME_UNAVAILABLE",
      },
      gateway: {
        state: "unavailable",
        issueCode: "AGENT_GATEWAY_RUNTIME_UNAVAILABLE",
      },
    });
    await expect(runtime.resolveGatewaySettings("docs-site")).resolves.toEqual({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "disabled",
      mcpHttp: "disabled",
      agentHttp: "disabled",
    });
    expect(() => requireAgentStudioConnectionRuntimeV1()).toThrow(
      "Agent Studio connection runtime is unavailable.",
    );
    expect(() => requireAgentStudioGatewayRuntimeV1()).toThrow(
      "Agent Studio Gateway runtime is unavailable.",
    );
  });

  it("installs and detaches only the expected host runtime", () => {
    const first = createAgentStudioServerRuntimeV1();
    const second = createAgentStudioServerRuntimeV1();

    expect(setAgentStudioServerRuntimeV1(first)).toBe(first);
    expect(setAgentStudioServerRuntimeV1(second)).toBe(second);
    resetAgentStudioServerRuntimeV1(first);
    expect(getOptionalAgentStudioServerRuntimeV1()).toBe(second);
    resetAgentStudioServerRuntimeV1(second);
    expect(getOptionalAgentStudioServerRuntimeV1()).toBeNull();
  });

  it("requires connection read and Admin services as one host-owned pair", () => {
    expect(() => createAgentStudioServerRuntimeV1({ connections: {} as never })).toThrow(
      "Agent Studio connection read and Admin services must be installed together.",
    );
  });

  it("reuses the Gateway service effective deployment and site ceiling", async () => {
    const getEffectiveGatewaySettings = () =>
      Promise.resolve({
        schemaVersion: "np.agent-gateway-settings.v1" as const,
        stdio: "read" as const,
        mcpHttp: "disabled" as const,
        agentHttp: "propose" as const,
      });
    const runtime = createAgentStudioServerRuntimeV1({
      gateway: { getEffectiveGatewaySettings } as never,
    });

    await expect(runtime.resolveGatewaySettings("docs-site")).resolves.toEqual({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "read",
      mcpHttp: "disabled",
      agentHttp: "propose",
    });
  });
});

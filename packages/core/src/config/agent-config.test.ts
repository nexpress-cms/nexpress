import { describe, expect, it } from "vitest";

import { npAgentDisabledGatewaySettingsV1 } from "../agent-contract/types.js";
import {
  npAgentDisabledProjectConfigV1,
  npResolveAgentDeploymentGatewaySettingsV1,
} from "./agent-config.js";

describe("Agent project config", () => {
  it("normalizes missing deployment intent to the exact disabled gateway posture", () => {
    expect(npResolveAgentDeploymentGatewaySettingsV1({})).toEqual(npAgentDisabledGatewaySettingsV1);
    expect(npResolveAgentDeploymentGatewaySettingsV1({ agents: {} })).toEqual(
      npAgentDisabledGatewaySettingsV1,
    );
    expect(
      npResolveAgentDeploymentGatewaySettingsV1({
        agents: npAgentDisabledProjectConfigV1,
      }),
    ).toEqual(npAgentDisabledGatewaySettingsV1);
    expect(Object.isFrozen(npAgentDisabledProjectConfigV1)).toBe(true);
  });

  it("returns a canonical copy of an exact non-secret deployment ceiling", () => {
    const gateway = {
      schemaVersion: "np.agent-gateway-settings.v1" as const,
      stdio: "read" as const,
      mcpHttp: "propose" as const,
      agentHttp: "approved-execute" as const,
    };
    const resolved = npResolveAgentDeploymentGatewaySettingsV1({ agents: { gateway } });

    expect(resolved).toEqual(gateway);
    expect(resolved).not.toBe(gateway);
  });
});

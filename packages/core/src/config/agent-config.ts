import { npRequireAgentGatewaySettings } from "../agent-contract/contract.js";
import {
  npAgentDisabledGatewaySettingsV1,
  type NpAgentGatewaySettingsV1,
} from "../agent-contract/types.js";
import type { NpAgentProjectConfigV1, NpConfig } from "./types.js";

/** Explicit, reusable project declaration for the normal dark-launch posture. */
export const npAgentDisabledProjectConfigV1: Readonly<NpAgentProjectConfigV1> = Object.freeze({
  gateway: npAgentDisabledGatewaySettingsV1,
});

/** Resolve the deployment ceiling without introducing any runtime credentials. */
export function npResolveAgentDeploymentGatewaySettingsV1(
  config: Pick<NpConfig, "agents">,
): NpAgentGatewaySettingsV1 {
  return npRequireAgentGatewaySettings(config.agents?.gateway ?? npAgentDisabledGatewaySettingsV1);
}

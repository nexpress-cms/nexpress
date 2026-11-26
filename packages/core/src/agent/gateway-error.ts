import { NpError } from "../errors.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";

/** Shared safe error identity without importing admission services or their lifecycle graph. */
export class NpAgentGatewayError extends NpError {
  constructor(
    code: string,
    public readonly status: number,
    message: string,
    details: NpAgentJsonObject = {},
  ) {
    super(message, code, status, details);
    this.name = "NpAgentGatewayError";
  }
}

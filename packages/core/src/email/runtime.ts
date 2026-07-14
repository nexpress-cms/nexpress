import {
  NpEmailContractError,
  npReadEmailRuntimeConfig,
  npRequireEmailRuntimeConfig,
} from "./contract.js";
import { getEmailAdapter, resetEmailAdapter, setEmailAdapter } from "./service.js";
import { SmtpEmailAdapter } from "./smtp.js";
import type { NpEmailRuntimeConfig } from "./types.js";

/** Install one already-resolved email runtime configuration. */
export function configureEmailRuntime(config: NpEmailRuntimeConfig): void {
  const validated = npRequireEmailRuntimeConfig(config);
  if (validated.adapter === "custom") {
    if (getEmailAdapter().kind === "noop") {
      throw new NpEmailContractError("Invalid email runtime configuration", [
        {
          code: "invariant",
          path: "email.runtime.adapter",
          message: "custom mode requires setEmailAdapter() before the worker or write bootstrap.",
        },
      ]);
    }
    return;
  }
  if (validated.adapter === "noop") {
    resetEmailAdapter();
    return;
  }
  setEmailAdapter(new SmtpEmailAdapter(validated.options));
}

/** Parse and install the exact process environment contract. */
export function configureEmailRuntimeFromEnv(
  env: Record<string, string | undefined>,
): NpEmailRuntimeConfig {
  const config = npReadEmailRuntimeConfig(env);
  configureEmailRuntime(config);
  return config;
}

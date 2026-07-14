import {
  NpEmailContractError,
  npReadEmailRuntimeConfig,
  npRequireEmailAdapter,
  npRequireEmailRuntimeConfig,
} from "./contract.js";
import { getEmailAdapter, resetEmailAdapter, setEmailAdapter } from "./service.js";
import { SmtpEmailAdapter } from "./smtp.js";
import type { NpEmailAdapter, NpEmailRuntimeConfig } from "./types.js";

/** Install one already-resolved email runtime configuration. */
export function configureEmailRuntime(
  config: NpEmailRuntimeConfig,
  customAdapter?: NpEmailAdapter,
): void {
  const validated = npRequireEmailRuntimeConfig(config);
  if (validated.adapter !== "custom" && customAdapter !== undefined) {
    throw new NpEmailContractError("Invalid email runtime configuration", [
      {
        code: "invariant",
        path: "email.runtime.adapter",
        message: "a custom adapter may only be injected when adapter is custom.",
      },
    ]);
  }
  if (validated.adapter === "custom") {
    const candidate =
      customAdapter === undefined ? getEmailAdapter() : npRequireEmailAdapter(customAdapter);
    if (candidate.kind === "noop") {
      throw new NpEmailContractError("Invalid email runtime configuration", [
        {
          code: "invariant",
          path: "email.runtime.adapter",
          message:
            "custom mode requires setEmailAdapter() or bootstrap emailAdapter injection before worker/write bootstrap.",
        },
      ]);
    }
    if (customAdapter !== undefined) setEmailAdapter(customAdapter);
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

import { NoopEmailAdapter } from "./noop.js";
import { NpEmailContractError, npRequireEmailAdapter, npRequireEmailMessage } from "./contract.js";
import type { NpEmailAdapter } from "./types.js";
import type { NpEmailMessage } from "./types.js";

let adapter: NpEmailAdapter = new NoopEmailAdapter();

export function setEmailAdapter(next: NpEmailAdapter): void {
  adapter = npRequireEmailAdapter(next);
}

export function getEmailAdapter(): NpEmailAdapter {
  return adapter;
}

/** Reset to the built-in stub. Primarily used by tests. */
export function resetEmailAdapter(): void {
  adapter = new NoopEmailAdapter();
}

/** Validate and dispatch one message through the registered adapter. */
export async function sendEmail(message: NpEmailMessage): Promise<void> {
  const validated = npRequireEmailMessage(message);
  const result: unknown = await adapter.send(validated);
  if (result !== undefined) {
    throw new NpEmailContractError("Invalid email adapter result", [
      {
        code: "invariant",
        path: "email.adapter.send.result",
        message: "must resolve to void.",
      },
    ]);
  }
}

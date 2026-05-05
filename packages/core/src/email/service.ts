import { NoopEmailAdapter } from "./noop.js";
import type { NpEmailAdapter } from "./types.js";

let adapter: NpEmailAdapter = new NoopEmailAdapter();

export function setEmailAdapter(next: NpEmailAdapter): void {
  adapter = next;
}

export function getEmailAdapter(): NpEmailAdapter {
  return adapter;
}

/** Reset to the built-in stub. Primarily used by tests. */
export function resetEmailAdapter(): void {
  adapter = new NoopEmailAdapter();
}

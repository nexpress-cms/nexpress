import { NoopEmailAdapter } from "./noop.js";
import type { NxEmailAdapter } from "./types.js";

let adapter: NxEmailAdapter = new NoopEmailAdapter();

export function setEmailAdapter(next: NxEmailAdapter): void {
  adapter = next;
}

export function getEmailAdapter(): NxEmailAdapter {
  return adapter;
}

/** Reset to the built-in stub. Primarily used by tests. */
export function resetEmailAdapter(): void {
  adapter = new NoopEmailAdapter();
}

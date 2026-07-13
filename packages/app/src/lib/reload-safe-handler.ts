const NP_RELOAD_SAFE_HANDLER_STORE = Symbol.for("np.app.reload-safe-handler-store");

type NpAsyncVoidHandler<TPayload> = (payload: TPayload) => Promise<void>;

interface NpReloadSafeHandlerState<TPayload> {
  implementation: NpAsyncVoidHandler<TPayload>;
  handler: NpAsyncVoidHandler<TPayload>;
}

function getStore(): Map<string, unknown> {
  const scope = globalThis as typeof globalThis & {
    [NP_RELOAD_SAFE_HANDLER_STORE]?: Map<string, unknown>;
  };
  const existing = scope[NP_RELOAD_SAFE_HANDLER_STORE];
  if (existing) return existing;
  const created = new Map<string, unknown>();
  scope[NP_RELOAD_SAFE_HANDLER_STORE] = created;
  return created;
}

/**
 * Keep one handler identity across Next/Vitest module re-evaluation while
 * forwarding calls to the newest module implementation. Core can therefore
 * retain strict duplicate-registration errors without treating an app reload
 * as a conflicting registration.
 */
export function npGetReloadSafeHandler<TPayload>(
  key: string,
  implementation: NpAsyncVoidHandler<TPayload>,
): NpAsyncVoidHandler<TPayload> {
  if (!/^np(?:\.[a-z0-9][a-z0-9-]*)+$/u.test(key)) {
    throw new Error("Reload-safe handler keys must use canonical np dot-segment syntax.");
  }
  if (typeof implementation !== "function") {
    throw new Error(`Reload-safe handler implementation for "${key}" must be a function.`);
  }

  const store = getStore();
  const existing = store.get(key) as NpReloadSafeHandlerState<TPayload> | undefined;
  if (existing) {
    existing.implementation = implementation;
    return existing.handler;
  }

  const state: NpReloadSafeHandlerState<TPayload> = {
    implementation,
    handler: async (payload) => state.implementation(payload),
  };
  store.set(key, state);
  return state.handler;
}

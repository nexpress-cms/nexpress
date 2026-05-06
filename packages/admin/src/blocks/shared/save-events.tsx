"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/**
 * Form-level save lifecycle the orchestrator's autosave indicator
 * subscribes to. The collection edit view emits these around its
 * `submitWithStatus` flow:
 *
 *   "saving" → before the network round-trip starts
 *   "saved"  → after the API responds OK
 *   "error"  → after the API responds non-OK
 *
 * Block-editor surfaces (`useEditorState` orchestrators) listen via
 * `useSaveEvents` to flip their dirty/saving/saved indicator. The
 * provider's emitter is stable across renders so subscribers don't
 * thrash.
 */
export type SaveEvent = "saving" | "saved" | "error";

type Listener = (event: SaveEvent) => void;

interface SaveEventsContextValue {
  subscribe: (listener: Listener) => () => void;
  emit: (event: SaveEvent) => void;
}

const SaveEventsContext = createContext<SaveEventsContextValue | null>(null);

export function SaveEventsProvider({ children }: { children: ReactNode }) {
  const listenersRef = useRef<Set<Listener>>(new Set());
  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);
  const emit = useCallback((event: SaveEvent) => {
    for (const listener of listenersRef.current) listener(event);
  }, []);
  // Both `subscribe` and `emit` are useCallback-stable (deps `[]`),
  // so useMemo returns the same object identity on every render —
  // children that depend on the context don't re-render on every
  // emit (events flow through the ref directly).
  const value = useMemo<SaveEventsContextValue>(() => ({ subscribe, emit }), [subscribe, emit]);
  return <SaveEventsContext.Provider value={value}>{children}</SaveEventsContext.Provider>;
}

/**
 * Returns the form-level save emitter. The collection edit view
 * calls this to fire `"saving"` / `"saved"` / `"error"` around
 * its submit flow. Returns a no-op when the provider isn't
 * mounted (older host code or non-form mounts) — the orchestrator
 * just shows a default-idle indicator in that case.
 */
export function useSaveEmitter(): (event: SaveEvent) => void {
  const ctx = useContext(SaveEventsContext);
  return ctx ? ctx.emit : noop;
}

/**
 * Subscribe to save events from inside an orchestrator. The
 * callback fires synchronously on every emit. Returns nothing —
 * the subscription cleans up on unmount automatically.
 */
export function useSaveEvents(listener: Listener): void {
  const ctx = useContext(SaveEventsContext);
  // Pin the listener in a ref so subscribe doesn't re-run on every
  // render. The user's callback might capture closures that need
  // up-to-date state; reading through the ref keeps the
  // subscription stable while still hitting the latest function.
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  }, [listener]);
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe((event) => ref.current(event));
  }, [ctx]);
}

function noop() {
  // Empty emitter — the form-card editor still shows its default
  // "dirty" pulse on edit, just never resolves to "saved".
}

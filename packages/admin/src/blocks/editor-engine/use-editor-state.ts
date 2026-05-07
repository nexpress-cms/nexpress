"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { createEditorReducer } from "./reducer.js";
import { createHistoryReducer } from "./history.js";
import type { EditorAction, HistoryState } from "./types.js";

const COALESCE_WINDOW_MS = 600;

export interface UseEditorStateOptions {
  /** Initial blocks tree (controls history reset on prop change). */
  initialBlocks: NpBlockInstance[];
  /** Available block metadata; the reducer closes over this to resolve types + contracts. */
  availableBlocks: NpBlockMetadata[];
  /**
   * Called whenever the present tree changes (after the first
   * render). The form editor wires this to a parent `onChange`
   * prop; the in-page editor would do the same against whatever
   * persistence surface it owns.
   */
  onChange: (blocks: NpBlockInstance[]) => void;
}

export interface EditorState {
  /** Current tree. */
  blocks: NpBlockInstance[];
  /** Wraps history `DO` so the form layer doesn't have to know about coalesce. */
  dispatch: (action: EditorAction) => void;
  /** Undo / redo. Both clear the coalesce-tracking ref so the next typing burst starts fresh. */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Replaces the present tree without growing history. Used by
   * the Page-JSON dialog after a successful Apply (operator
   * intent: blow away the old state and start from the pasted
   * tree).
   */
  resetHistory: (blocks: NpBlockInstance[]) => void;
}

/**
 * React hook that composes the editor reducer + history wrapper +
 * onChange effect + dispatch coalescing into a single state
 * surface.
 *
 * Designed so different editor UIs (form-card editor today, in-page
 * editor later) can share the same state machine — this hook plus
 * the `EditorAction` set is the contract between engine and UI.
 */
export function useEditorState({
  initialBlocks,
  availableBlocks,
  onChange,
}: UseEditorStateOptions): EditorState {
  const innerReducer = useMemo(
    () => createEditorReducer(availableBlocks),
    [availableBlocks],
  );
  const historyReducer = useMemo(
    () => createHistoryReducer(innerReducer),
    [innerReducer],
  );
  const [history, historyDispatch] = useReducer(historyReducer, {
    past: [],
    present: initialBlocks,
    future: [],
  } as HistoryState<NpBlockInstance[]>);
  const blocks = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // Track the current present's JSON shape so the reset-on-prop-
  // change effect below can tell our own onChange echo from a real
  // external swap. Without this, every dispatch killed undo/redo:
  //
  //   1. dispatch → present updates, history grows
  //   2. onChange(present) → parent setState → re-renders us
  //   3. parent passes the same tree back as `initialBlocks`
  //   4. `initialBlocksKey` changes → reset effect blew past away
  //
  // The ref is updated BEFORE the reset effect runs (effects fire
  // in declaration order) so the comparison sees the latest present.
  const presentKeyRef = useRef(JSON.stringify(initialBlocks));
  useEffect(() => {
    presentKeyRef.current = JSON.stringify(blocks);
  }, [blocks]);

  // Reset history whenever the upstream `initialBlocks` swaps
  // (route nav, server reload). We compare on a stable key
  // (JSON snapshot) instead of reference identity since the
  // parent often passes a freshly-built array on every render.
  const initialBlocksKey = useMemo(
    () => JSON.stringify(initialBlocks),
    [initialBlocks],
  );
  useEffect(() => {
    // Self-echo guard: when the new initialBlocks already matches
    // our current present, the parent is just bouncing our own
    // dispatch back. Skip the reset so undo/redo stays intact.
    if (initialBlocksKey === presentKeyRef.current) return;
    historyDispatch({ type: "RESET_HISTORY", blocks: initialBlocks });
    lastUpdateRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBlocksKey]);

  // Notify the parent on every state change after first mount.
  // First-render skip avoids echoing back the initial tree.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onChange(blocks);
  }, [blocks, onChange]);

  // Coalescing window for typing. Consecutive UPDATE_PROPS calls
  // to the same block within this window collapse into a single
  // undo step so a sentence-long edit doesn't bury earlier
  // history.
  const lastUpdateRef = useRef<{ time: number; id: string } | null>(null);
  const dispatch = useCallback((action: EditorAction) => {
    let coalesce = false;
    if (action.type === "UPDATE_PROPS") {
      const now = Date.now();
      const last = lastUpdateRef.current;
      if (last && last.id === action.id && now - last.time < COALESCE_WINDOW_MS) {
        coalesce = true;
      }
      lastUpdateRef.current = { time: now, id: action.id };
    } else {
      lastUpdateRef.current = null;
    }
    historyDispatch({ type: "DO", action, coalesce });
  }, []);

  // Clearing `lastUpdateRef` on undo/redo prevents the next
  // typing burst from being coalesced into the post-undo state —
  // without this, an edit made within 600 ms of an undo would
  // replace `present` without growing `past`, so it couldn't be
  // undone.
  const undo = useCallback(() => {
    lastUpdateRef.current = null;
    historyDispatch({ type: "UNDO" });
  }, []);
  const redo = useCallback(() => {
    lastUpdateRef.current = null;
    historyDispatch({ type: "REDO" });
  }, []);
  const resetHistory = useCallback((nextBlocks: NpBlockInstance[]) => {
    lastUpdateRef.current = null;
    historyDispatch({ type: "RESET_HISTORY", blocks: nextBlocks });
  }, []);

  return { blocks, dispatch, undo, redo, canUndo, canRedo, resetHistory };
}

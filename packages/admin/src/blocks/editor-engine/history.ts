import type { NpBlockInstance } from "@nexpress/blocks";

import type { EditorAction, HistoryAction, HistoryState } from "./types.js";

const HISTORY_LIMIT = 50;

/**
 * Wraps the editor reducer with a past/future stack. Only state-
 * mutating actions push history; UPDATE_PROPS is coalesced when
 * the operator is typing into the same block within the configured
 * window, so a sentence-long edit collapses to a single undo step.
 *
 * `RESET_HISTORY` clears history — used when the backing document
 * changes underneath the editor (server reload, JSON-apply, route
 * nav).
 */
export const createHistoryReducer =
  (inner: (state: NpBlockInstance[], action: EditorAction) => NpBlockInstance[]) =>
  (
    state: HistoryState<NpBlockInstance[]>,
    action: HistoryAction,
  ): HistoryState<NpBlockInstance[]> => {
    switch (action.type) {
      case "RESET_HISTORY":
        return { past: [], present: action.blocks, future: [], lastUpdate: null };
      case "UNDO": {
        if (state.past.length === 0) return state;
        const previous = state.past[state.past.length - 1];
        return {
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future],
          lastUpdate: null,
        };
      }
      case "REDO": {
        if (state.future.length === 0) return state;
        const [next, ...rest] = state.future;
        return {
          past: [...state.past, state.present],
          present: next,
          future: rest,
          lastUpdate: null,
        };
      }
      case "DO": {
        let coalesce = false;
        let lastUpdate: HistoryState<NpBlockInstance[]>["lastUpdate"] = null;
        if (action.action.type === "UPDATE_PROPS") {
          const last = state.lastUpdate;
          coalesce =
            !!last &&
            last.id === action.action.id &&
            action.now - last.time < action.coalesceWindowMs;
          lastUpdate = { time: action.now, id: action.action.id };
        }
        const next = inner(state.present, action.action);
        if (next === state.present) {
          return lastUpdate === state.lastUpdate ? state : { ...state, lastUpdate };
        }
        if (coalesce && state.past.length > 0) {
          // Replace `present` without growing `past` so a typing
          // burst collapses into one undo step.
          return { past: state.past, present: next, future: [], lastUpdate };
        }
        const past = [...state.past, state.present];
        if (past.length > HISTORY_LIMIT) past.shift();
        return { past, present: next, future: [], lastUpdate };
      }
      default:
        return state;
    }
  };

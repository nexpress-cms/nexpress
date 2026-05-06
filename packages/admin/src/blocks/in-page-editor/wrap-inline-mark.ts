"use client";

/**
 * Wrap the active textarea's selection in markdown delimiters
 * (`**`, `*`, `_`, `~~`, `` ` ``). Operates on `document.activeElement`
 * directly so both the sticky `EditorToolbar` and the floating
 * `InlineSelectionToolbar` can share one implementation.
 *
 * Both call sites must guard the click with
 * `onMouseDown.preventDefault` so the textarea keeps focus through
 * the click — otherwise `document.activeElement` would be the
 * button by the time we read it. The Lexical body case is a no-op
 * stub today; v1.1 wires the command bridge.
 *
 * Returns `true` when the wrap actually happened, `false` for any
 * branch that was skipped (no textarea focused, etc.). Callers
 * don't need the boolean today, but it's there for tests.
 */
export function wrapInlineMark(delimiter: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLTextAreaElement)) {
    // Lexical path — v1 stub. Once the Lexical command bridge
    // lands, this branch dispatches `FORMAT_TEXT_COMMAND`.
    return false;
  }
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const value = el.value;
  const before = value.slice(0, start);
  const selection = value.slice(start, end);
  const after = value.slice(end);
  // No selection → insert paired delimiters with the caret
  // between them, ready to type the marked text.
  const insert = selection.length > 0 ? selection : "";
  const next = `${before}${delimiter}${insert}${delimiter}${after}`;
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    // Fallback: fire a DOM event the AutoGrowTextarea reads via
    // its onChange. This path is rare (browsers ship the value
    // setter universally).
    el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // Restore selection across the just-inserted text — the React
  // re-render hasn't run yet at this synchronous point, so we
  // schedule on the next animation frame to land after it.
  const cursorStart = start + delimiter.length;
  const cursorEnd = cursorStart + insert.length;
  requestAnimationFrame(() => {
    el.setSelectionRange(cursorStart, cursorEnd);
    el.focus();
  });
  return true;
}

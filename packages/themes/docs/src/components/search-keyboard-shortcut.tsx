"use client";

import { useEffect } from "react";

/**
 * Wires Cmd+K / Ctrl+K to focus the docs search input. The
 * header renders a `<kbd>⌘K</kbd>` affordance next to the
 * pill; this component is the thing that actually honors it.
 */
export function SearchKeyboardShortcut({ targetId }: { targetId: string }) {
  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (event.key !== "k" && event.key !== "K") return;
      const cmdOrCtrl = event.metaKey || event.ctrlKey;
      if (!cmdOrCtrl) return;
      const el = document.getElementById(targetId);
      if (!(el instanceof HTMLInputElement)) return;
      event.preventDefault();
      el.focus();
      el.select();
    }
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("keydown", onKeydown);
    };
  }, [targetId]);
  return null;
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Mounts the block editor's aside content (Outline / Container
 * warnings) into a host-provided DOM target — typically a sticky
 * sidebar in the surrounding form layout. This lets the editor
 * keep its canvas full-width while the related metadata cards live
 * in the form's right column, matching the design's
 * `editor-aside` (a single right column with Status / Slug /
 * Page tree / Warnings stacked).
 *
 * The target is referenced by id rather than by ref so the editor
 * doesn't need an explicit ref handoff from the form. The host
 * just renders `<div id={targetId} />` somewhere visible. If the
 * target isn't found at mount time, the portal renders nothing —
 * losing the aside is preferable to a layout crash, and dev mode
 * surfaces a console warning so the misconfiguration is visible.
 */
export interface EditorAsidePortalProps {
  /**
   * DOM id of the host's mount target. Default
   * `"np-block-editor-aside"` matches the convention in
   * `CollectionEditView`'s right sidebar.
   */
  targetId?: string;
  children: ReactNode;
}

export function EditorAsidePortal({
  targetId = "np-block-editor-aside",
  children,
}: EditorAsidePortalProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(targetId);
    if (!el) {
      // Dev hint — production sites would intentionally omit the
      // target if they don't want the aside; emitting only at
      // module-eval time once would miss the case where the
      // editor mounts after the form. Log on every mount keeps
      // the signal alive across re-mounts.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          `[np] EditorAsidePortal: target #${targetId} not found in the DOM. Outline / warnings will not render. Mount a <div id="${targetId}" /> in your form sidebar.`,
        );
      }
      setTarget(null);
      return;
    }
    setTarget(el);
  }, [targetId]);

  if (target === null) return null;
  return createPortal(children, target);
}

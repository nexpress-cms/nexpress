"use client";

import type { ReactElement } from "react";
import type { NpBlockMetadata } from "@nexpress/blocks";

import { PaletteModal } from "./shared/palette-modal.js";

interface BlockPaletteProps {
  availableBlocks: NpBlockMetadata[];
  onAdd: (type: string) => void;
  trigger: ReactElement;
}

/**
 * Categorized block picker. Used by the form-card editor row's
 * "Add child block" button and any plugin code that imports
 * `BlockPalette` directly.
 *
 * @deprecated Prefer `PaletteModal` from `./shared/palette-modal.js`
 *   for new code — the named export here is preserved for plugin
 *   back-compat. Both render the same modal surface; this shell
 *   exists only to keep the long-standing `BlockPalette` import
 *   path working.
 */
export function BlockPalette({
  availableBlocks,
  onAdd,
  trigger,
}: BlockPaletteProps) {
  return (
    <PaletteModal
      availableBlocks={availableBlocks}
      onAdd={onAdd}
      trigger={trigger}
    />
  );
}

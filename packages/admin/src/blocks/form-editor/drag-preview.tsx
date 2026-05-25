"use client";

import type { ReactNode } from "react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { Card } from "../../ui/card.js";

/**
 * dnd-kit drag overlay — a floating card showing the block's
 * label + type while the operator drags. Form-editor specific:
 * the overlay reuses the row-card visual so the drag feedback
 * matches what's about to land.
 */

export interface DragPreviewProps {
  block?: NpBlockInstance;
  definition?: NpBlockMetadata;
}

export function DragPreview({ block, definition }: DragPreviewProps): ReactNode {
  if (!block) return null;
  return (
    <Card className="w-[min(18rem,calc(100vw-2rem))] min-w-0 border-border/60 px-4 py-3 shadow-2xl">
      <div className="truncate text-sm font-semibold">{definition?.label ?? block.type}</div>
      <div className="truncate font-mono text-xs text-muted-foreground">{block.type}</div>
    </Card>
  );
}

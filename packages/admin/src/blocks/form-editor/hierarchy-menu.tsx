"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { ContainerCandidate } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.js";

/**
 * Row-header dropdown for cross-hierarchy moves.
 * Mirrors the Cmd-K commands so mouse operators don't need to
 * know the keyboard shortcut. Move-into candidates are resolved
 * lazily on dropdown open via `getMoveIntoCandidates(id)` so we
 * don't pay the tree-walk cost on every render.
 *
 * Form-editor specific: the menu is anchored to a row card. Doc
 * view keeps deeper hierarchy moves in Page builder where
 * container boundaries are visible.
 */

export interface HierarchyMenuProps {
  block: NpBlockInstance;
  parentBlock?: NpBlockInstance;
  availableBlocks: NpBlockMetadata[];
  onMoveOut: (id: string) => void;
  onMoveInto: (id: string, targetParentId: string) => void;
  onWrapIn: (id: string, containerType: string) => void;
  getMoveIntoCandidates: (id: string) => ContainerCandidate[];
}

export function HierarchyMenu({
  block,
  parentBlock,
  availableBlocks,
  onMoveOut,
  onMoveInto,
  onWrapIn,
  getMoveIntoCandidates,
}: HierarchyMenuProps) {
  const [open, setOpen] = useState(false);
  const candidates = open ? getMoveIntoCandidates(block.id) : [];

  // Wrap-in targets — every container block except the source's
  // own type. We compute this every render because availableBlocks
  // is small + `acceptsChildren` is a flat field on the metadata
  // (no tree walk).
  const wrapTargets = availableBlocks.filter(
    (def) => def.acceptsChildren && def.type !== block.type,
  );
  const canMoveOut = parentBlock !== undefined;

  // Hide the dropdown entirely when there are no actions to
  // surface — keeps the row header tidy on a top-level leaf
  // block with no other containers in the page.
  const hasActions = canMoveOut || candidates.length > 0 || wrapTargets.length > 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="More actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {!hasActions ? (
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            No hierarchy moves available
          </DropdownMenuLabel>
        ) : null}
        {canMoveOut ? (
          <DropdownMenuItem onSelect={() => onMoveOut(block.id)}>
            Move out of {parentBlock?.type ?? "parent"}
          </DropdownMenuItem>
        ) : null}
        {candidates.length > 0 ? (
          <>
            {canMoveOut ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Move into
            </DropdownMenuLabel>
            {candidates.map((c) => (
              <DropdownMenuItem key={`into-${c.id}`} onSelect={() => onMoveInto(block.id, c.id)}>
                {c.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {wrapTargets.length > 0 ? (
          <>
            {canMoveOut || candidates.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Wrap in
            </DropdownMenuLabel>
            {wrapTargets.map((def) => (
              <DropdownMenuItem
                key={`wrap-${def.type}`}
                onSelect={() => onWrapIn(block.id, def.type)}
              >
                {def.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

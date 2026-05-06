"use client";

import type { Dispatch } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  MoreHorizontal,
  Trash2,
  Wand2,
} from "lucide-react";
import type { NpBlockMetadata } from "@nexpress/blocks";

import type { EditorAction } from "../editor-engine/index.js";
import { BlockIcon } from "../shared/block-icon.js";
import { Button } from "../../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.js";
import { cn } from "../../ui/utils.js";

export interface BlockActionsPopoverProps {
  blockId: string;
  blockType: string;
  dispatch: Dispatch<EditorAction>;
  /** Doc-friendly types (excluding the source's own type). */
  convertCandidates: NpBlockMetadata[];
}

/**
 * Row-level actions popover. Triggered from the grip button on
 * the hover rail. Surfaces the same EditorActions the form-card
 * editor's row dropdown supports, plus a "Turn into…" submenu
 * over Doc-friendly types.
 */
export function BlockActionsPopover({
  blockId,
  blockType,
  dispatch,
  convertCandidates,
}: BlockActionsPopoverProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground"
          aria-label="Block actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem
          onSelect={() => dispatch({ type: "DUPLICATE", id: blockId })}
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => dispatch({ type: "MOVE_UP", id: blockId })}
        >
          <ChevronUp className="mr-2 h-3.5 w-3.5" />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => dispatch({ type: "MOVE_DOWN", id: blockId })}
        >
          <ChevronDown className="mr-2 h-3.5 w-3.5" />
          Move down
        </DropdownMenuItem>
        {convertCandidates.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Turn into
            </div>
            {convertCandidates.map((meta) => (
              <DropdownMenuItem
                key={meta.type}
                onSelect={() =>
                  dispatch({
                    type: "REPLACE_TYPE",
                    id: blockId,
                    newType: meta.type,
                  })
                }
              >
                <BlockIcon
                  icon={meta.icon}
                  kind={meta.iconKind}
                  sizeClassName="h-3.5 w-3.5"
                  className="mr-2 text-muted-foreground"
                />
                {meta.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : (
          <DropdownMenuItem disabled>
            <Wand2 className="mr-2 h-3.5 w-3.5" />
            <span className="text-muted-foreground">
              Nothing to turn this into
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={cn("text-destructive focus:text-destructive")}
          onSelect={() => dispatch({ type: "DELETE", id: blockId })}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {blockType}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

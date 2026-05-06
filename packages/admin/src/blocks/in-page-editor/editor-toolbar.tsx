"use client";

import type { Dispatch } from "react";
import type { NpBlockInstance } from "@nexpress/blocks";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List as ListIcon,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Strikethrough,
  Underline,
  type LucideIcon,
} from "lucide-react";

import type { EditorAction } from "../editor-engine/index.js";
import { cn } from "../../ui/utils.js";

interface ToolbarButtonProps {
  Icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}

function ToolbarButton({
  Icon,
  label,
  onClick,
  active,
  disabled,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground",
        active && "bg-primary/10 text-primary",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-800" />;
}

export interface EditorToolbarProps {
  activeBlock: NpBlockInstance | null;
  /** Whether focus is currently inside a Lexical rich-text body. */
  inRichText: boolean;
  dispatch: Dispatch<EditorAction>;
}

/**
 * Sticky formatting toolbar. Two segments:
 *
 * 1. **Block-level** — Pilcrow / H1-3 / Quote / Code / List /
 *    List-ordered / HR. Always enabled when a row is focused;
 *    dispatches `REPLACE_TYPE` (or `INSERT_AFTER` for the HR
 *    button — divider is its own block, not a type swap).
 * 2. **Inline marks** — Bold / Italic / Underline / Strikethrough
 *    / Inline-code / Link / Image. Enabled only when focus is
 *    inside a Lexical body (the rich-text block). Atom bodies
 *    don't carry marks in v1; the buttons disable with a tooltip.
 */
export function EditorToolbar({
  activeBlock,
  inRichText,
  dispatch,
}: EditorToolbarProps) {
  const activeBlockId = activeBlock?.id ?? null;
  const activeBlockType = activeBlock?.type ?? null;

  const replace = (newType: string) => {
    if (!activeBlockId) return;
    dispatch({ type: "REPLACE_TYPE", id: activeBlockId, newType });
  };
  // Heading is one block type with a `level` prop. Clicking H1 /
  // H2 / H3 lands `REPLACE_TYPE → "heading"` and then an
  // `UPDATE_PROPS` so the level reflects the operator's choice
  // rather than the block's defaultProps level (always 2).
  const replaceHeading = (level: 1 | 2 | 3) => {
    if (!activeBlockId) return;
    dispatch({ type: "REPLACE_TYPE", id: activeBlockId, newType: "heading" });
    dispatch({ type: "UPDATE_PROPS", id: activeBlockId, props: { level } });
  };
  // Same pattern for the ordered/unordered list pair.
  const replaceList = (ordered: boolean) => {
    if (!activeBlockId) return;
    dispatch({ type: "REPLACE_TYPE", id: activeBlockId, newType: "list" });
    dispatch({ type: "UPDATE_PROPS", id: activeBlockId, props: { ordered } });
  };
  const insertAfter = (newType: string) => {
    if (!activeBlockId) return;
    dispatch({
      type: "INSERT_AFTER",
      targetId: activeBlockId,
      blockType: newType,
    });
  };

  // Heading-level active state — read the live `level` prop on a
  // heading-type block so H1/H2/H3 highlight the right button.
  const headingLevel =
    activeBlockType === "heading" &&
    typeof activeBlock?.props.level === "number"
      ? activeBlock.props.level
      : null;
  const isHeading1 = headingLevel === 1;
  const isHeading2 = headingLevel === 2;
  const isHeading3 = headingLevel === 3;
  const isListOrdered =
    activeBlockType === "list" && activeBlock?.props.ordered === true;
  const isListBullet = activeBlockType === "list" && !isListOrdered;

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className={cn(
        "sticky top-2 z-10 flex items-center gap-0.5 rounded-lg border border-neutral-200/80 bg-white/90 px-1 py-1 shadow-sm backdrop-blur-md",
        "dark:border-neutral-800/80 dark:bg-neutral-950/90",
      )}
    >
      <ToolbarButton
        Icon={Pilcrow}
        label="Paragraph"
        onClick={() => replace("paragraph")}
        active={activeBlockType === "paragraph"}
        disabled={!activeBlockId}
      />
      <ToolbarButton
        Icon={Heading1}
        label="Heading 1"
        onClick={() => replaceHeading(1)}
        active={isHeading1}
        disabled={!activeBlockId}
      />
      <ToolbarButton
        Icon={Heading2}
        label="Heading 2"
        onClick={() => replaceHeading(2)}
        active={isHeading2}
        disabled={!activeBlockId}
      />
      <ToolbarButton
        Icon={Heading3}
        label="Heading 3"
        onClick={() => replaceHeading(3)}
        active={isHeading3}
        disabled={!activeBlockId}
      />
      <ToolbarButton
        Icon={Quote}
        label="Quote"
        onClick={() => replace("quote")}
        active={activeBlockType === "quote"}
        disabled={!activeBlockId}
      />
      <ToolbarButton
        Icon={Code}
        label="Code block"
        onClick={() => replace("code")}
        active={activeBlockType === "code"}
        disabled={!activeBlockId}
      />
      <Sep />
      <ToolbarButton
        Icon={ListIcon}
        label="Bulleted list"
        onClick={() => replaceList(false)}
        active={isListBullet}
        disabled={!activeBlockId}
      />
      <ToolbarButton
        Icon={ListOrdered}
        label="Numbered list"
        onClick={() => replaceList(true)}
        active={isListOrdered}
        disabled={!activeBlockId}
      />
      <ToolbarButton
        Icon={Minus}
        label="Divider"
        onClick={() => insertAfter("divider")}
        disabled={!activeBlockId}
      />
      <ToolbarButton
        Icon={ImageIcon}
        label="Image"
        onClick={() => insertAfter("image")}
        disabled={!activeBlockId}
      />
      <Sep />
      <ToolbarButton Icon={Bold} label="Bold (rich-text only)" disabled={!inRichText} />
      <ToolbarButton Icon={Italic} label="Italic (rich-text only)" disabled={!inRichText} />
      <ToolbarButton Icon={Underline} label="Underline (rich-text only)" disabled={!inRichText} />
      <ToolbarButton
        Icon={Strikethrough}
        label="Strikethrough (rich-text only)"
        disabled={!inRichText}
      />
      <ToolbarButton Icon={LinkIcon} label="Link (rich-text only)" disabled={!inRichText} />
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  npValidateBlockContentAgainstDefinitions,
  type NpBlockInstance,
  type NpBlockMetadata,
} from "@nexpress/blocks";

import { cloneBlockDeep } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Label } from "../../ui/label.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";

/**
 * Page-level JSON editor. Shows the entire blocks tree, lets the
 * operator hand-edit, and dispatches RESET on Apply. Validates:
 *   1. valid JSON
 *   2. top level is an array
 *   3. the complete shared block-content wire contract
 *   4. known prop/container definitions (unknown types remain warnings)
 *
 * Two modes:
 * - Replace (default): Apply replaces the entire tree.
 * - Import as new blocks: validated input gets fresh ids and
 *   appends to the existing tree. Lets operators paste a section
 *   from another page without nuking the current one.
 *
 * Two-stage Apply (Preview → Confirm) so a paste that's about to
 * overwrite work surfaces a +/-/~ diff before committing.
 */

export interface PageJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: NpBlockInstance[];
  definitions: NpBlockMetadata[];
  onApply: (nextBlocks: NpBlockInstance[]) => void;
}

interface ApplyDiff {
  totalBefore: number;
  totalAfter: number;
  added: number;
  removed: number;
  modified: number;
}

/**
 * Walk a tree and emit `id → type` pairs so the diff can detect
 * "same id, different type" as a *modified* block instead of one
 * add + one remove.
 */
function flattenIdTypes(blocks: NpBlockInstance[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (arr: NpBlockInstance[]): void => {
    for (const b of arr) {
      out.set(b.id, b.type);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

function summarizeApplyDiff(before: NpBlockInstance[], after: NpBlockInstance[]): ApplyDiff {
  const beforeMap = flattenIdTypes(before);
  const afterMap = flattenIdTypes(after);
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const [id, type] of afterMap) {
    const prev = beforeMap.get(id);
    if (prev === undefined) added += 1;
    else if (prev !== type) modified += 1;
  }
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) removed += 1;
  }
  return {
    totalBefore: beforeMap.size,
    totalAfter: afterMap.size,
    added,
    removed,
    modified,
  };
}

export function PageJsonDialog({
  open,
  onOpenChange,
  blocks,
  definitions,
  onApply,
}: PageJsonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <PageJsonDialogContent
          blocks={blocks}
          definitions={definitions}
          onApply={onApply}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function PageJsonDialogContent({
  blocks,
  definitions,
  onOpenChange,
  onApply,
}: Omit<PageJsonDialogProps, "open">) {
  const [text, setText] = useState(() => JSON.stringify(blocks, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importAsNew, setImportAsNew] = useState(false);
  const [pendingApply, setPendingApply] = useState<{
    next: NpBlockInstance[];
    diff: ApplyDiff;
    warning: string | null;
  } | null>(null);

  function handleFormat() {
    try {
      const parsed: unknown = JSON.parse(text);
      setText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failures are silent — operators can still
      // select-all + Cmd-C from the textarea.
    }
  }

  function handlePreview() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    const result = npValidateBlockContentAgainstDefinitions(parsed, definitions);
    if (!result.ok) {
      setError(
        result.issues.find((issue) => issue.severity === "error")?.message ??
          "Invalid block content.",
      );
      return;
    }
    const validated = result.value;

    const contractWarning =
      result.warnings.length > 0 ? result.warnings.map((issue) => issue.message).join(" ") : null;

    // `cloneBlockDeep` re-ids the whole subtree (recursive over
    // `children`), so a paste from another page doesn't bring its
    // source ids along — those would collide with existing rows
    // or carry stale dnd-kit state across sessions.
    const next = importAsNew ? [...blocks, ...validated.map(cloneBlockDeep)] : validated;
    const diff = summarizeApplyDiff(blocks, next);
    setPendingApply({ next, diff, warning: contractWarning });
    setWarning(contractWarning);
  }

  function handleConfirm() {
    if (!pendingApply) return;
    onApply(pendingApply.next);
    onOpenChange(false);
  }

  function clearPreview() {
    setPendingApply(null);
  }

  return (
    <DialogContent className="min-w-0 max-w-3xl">
      <DialogHeader>
        <DialogTitle className="break-words">Edit page blocks as JSON</DialogTitle>
        <DialogDescription className="break-words">
          Apply replaces the entire block tree. Use this for bulk edits, paste-from-another-page, or
          recovering from a corrupted state.
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full sm:w-auto"
          onClick={handleFormat}
        >
          Format
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </Button>
        <div className="col-span-1 flex min-w-0 items-center gap-2 min-[360px]:col-span-2 sm:col-span-1 sm:ml-auto">
          <Switch
            id="np-page-json-import-as-new"
            checked={importAsNew}
            onCheckedChange={(checked) => {
              setImportAsNew(checked);
              clearPreview();
            }}
          />
          <Label
            htmlFor="np-page-json-import-as-new"
            className="min-w-0 flex-1 break-words text-xs font-normal text-muted-foreground"
          >
            Import as new blocks (append, fresh ids)
          </Label>
        </div>
      </div>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setError(null);
          setWarning(null);
          clearPreview();
        }}
        rows={20}
        className="max-h-[45dvh] min-h-[16rem] min-w-0 resize-y font-mono text-xs"
        spellCheck={false}
      />
      {error ? (
        <div
          role="alert"
          className="break-words rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}
      {warning ? (
        <div
          role="status"
          className="break-words rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          {warning}
        </div>
      ) : null}
      {pendingApply ? (
        <div
          role="status"
          className="min-w-0 break-words rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
        >
          <div className="font-medium uppercase tracking-wider text-primary">Apply preview</div>
          <div className="mt-1 text-foreground">
            {pendingApply.diff.totalBefore} block
            {pendingApply.diff.totalBefore === 1 ? "" : "s"} → {pendingApply.diff.totalAfter} block
            {pendingApply.diff.totalAfter === 1 ? "" : "s"} (
            <span className="text-emerald-600 dark:text-emerald-400">
              +{pendingApply.diff.added}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">−{pendingApply.diff.removed}</span>{" "}
            <span className="text-amber-600 dark:text-amber-400">
              ~{pendingApply.diff.modified}
            </span>
            )
          </div>
          <div className="mt-1 text-muted-foreground">
            {importAsNew
              ? "Import-as-new mode — validated input appends with fresh ids."
              : "Replace mode — current tree is overwritten."}
          </div>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        {pendingApply ? (
          <>
            <Button type="button" variant="outline" onClick={clearPreview}>
              Edit more
            </Button>
            <Button type="button" onClick={handleConfirm}>
              Confirm apply
            </Button>
          </>
        ) : (
          <Button type="button" onClick={handlePreview}>
            Preview
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { NpBlockPropField } from "@nexpress/blocks";

import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Textarea } from "../../ui/textarea.js";

/**
 * Per-block JSON editor. Shows the block's `props` as pretty-
 * printed JSON, lets the operator hand-edit, and dispatches
 * REPLACE_PROPS on Apply (replace, not merge — operators expect
 * "remove key in JSON" to actually remove). Validates JSON.parse
 * + non-array object shape, plus soft warnings against the
 * registered propsSchema (missing required / unknown keys).
 *
 * Two-stage Apply when there's a lint warning: first click
 * surfaces the banner, second click commits.
 */

export interface BlockJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockType: string;
  props: Record<string, unknown>;
  propsSchema?: NpBlockPropField[];
  onApply: (nextProps: Record<string, unknown>) => void;
}

/**
 * Lints `props` against the registered prop schema and returns
 * soft warnings (missing required, unknown keys). Returning a
 * string (not throwing) keeps Apply non-blocking — operators can
 * still save a paste that hasn't been schema-finalized yet, the
 * banner just flags it.
 */
function lintBlockProps(
  props: Record<string, unknown>,
  schema: NpBlockPropField[] | undefined,
): string | null {
  if (!schema || schema.length === 0) return null;
  const known = new Set(schema.map((field) => field.name));
  const warnings: string[] = [];

  for (const field of schema) {
    if (!field.required) continue;
    const value = props[field.name];
    if (value === undefined || value === "" || value === null) {
      warnings.push(`missing required \`${field.name}\``);
    }
  }

  for (const key of Object.keys(props)) {
    if (key === "_layout") continue; // grid-child layout meta, not in propsSchema
    if (!known.has(key)) warnings.push(`unknown key \`${key}\``);
  }

  return warnings.length > 0 ? warnings.join("; ") : null;
}

export function BlockJsonDialog({
  open,
  onOpenChange,
  blockType,
  props,
  propsSchema,
  onApply,
}: BlockJsonDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reseed the textarea every time the dialog opens, so closing
  // and reopening reflects the latest committed state — operators
  // who tweak via the field form between JSON edits expect the
  // dialog to catch up.
  useEffect(() => {
    if (open) {
      setText(JSON.stringify(props, null, 2));
      setError(null);
      setWarning(null);
      setCopied(false);
    }
  }, [open, props]);

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

  function handleApply() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Block props must be a JSON object.");
      return;
    }
    const lintWarning = lintBlockProps(parsed as Record<string, unknown>, propsSchema);
    if (lintWarning && lintWarning !== warning) {
      // First time seeing this exact warning — show it and pause.
      // The operator clicks Apply again to confirm; the comparison
      // resets the moment they edit the textarea.
      setWarning(lintWarning);
      return;
    }
    onApply(parsed as Record<string, unknown>);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">Edit block props as JSON</DialogTitle>
          <DialogDescription className="break-words">
            <span className="break-all font-mono">{blockType}</span> — Apply replaces the entire{" "}
            <code className="break-all">props</code> object. Keys you remove here will be dropped on
            save.
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
        </div>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setError(null);
            setWarning(null);
          }}
          rows={16}
          className="max-h-[45dvh] min-h-[14rem] min-w-0 resize-y font-mono text-xs"
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
            Schema warning: {warning}. Click Apply again to commit anyway.
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            {warning ? "Apply anyway" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

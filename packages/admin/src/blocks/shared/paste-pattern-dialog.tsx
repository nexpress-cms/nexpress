"use client";

import { useState } from "react";
import { npValidateBlockContent, type NpBlockInstance, type NpPattern } from "@nexpress/blocks";

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
import { Textarea } from "../../ui/textarea.js";

/**
 * Paste-import dialog (#467 medium tier). Operators paste a JSON
 * snippet — either a single `NpBlockInstance` or an array of them
 * (the same wire format `getBuiltInPatterns` produces) — and the
 * dialog wraps it as a synthetic `NpPattern` and dispatches
 * `INSERT_PATTERN`. Reuse path for the existing reducer keeps the
 * id-regeneration + parent-aware insertion in one place.
 *
 * Validation surface:
 *   1. valid JSON
 *   2. either an object (single block), an array, or a pattern object
 *   3. the complete shared block-content wire contract
 */

export interface PastePatternDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knownTypes: string[];
  onApply: (pattern: NpPattern) => void;
}

interface ValidationResult {
  ok: boolean;
  parsed?: NpBlockInstance[];
  error?: string;
  warning?: string;
}

function validate(raw: string, known: Set<string>): ValidationResult {
  if (raw.trim().length === 0) {
    return { ok: false, error: "Paste a block or array of blocks." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // Accept three shapes: a single block, an array of blocks, or
  // a pattern object with `blocks: [...]`. The third lets an
  // operator copy a built-in pattern dump straight in.
  let candidate: unknown;
  if (Array.isArray(parsed)) {
    candidate = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { blocks?: unknown }).blocks)
  ) {
    candidate = (parsed as { blocks: unknown }).blocks;
  } else if (parsed && typeof parsed === "object") {
    candidate = [parsed];
  } else {
    return {
      ok: false,
      error: "Top level must be a block, an array of blocks, or a pattern object.",
    };
  }
  const validation = npValidateBlockContent(candidate);
  if (!validation.ok) return { ok: false, error: validation.message };
  if (validation.value.length === 0) {
    return { ok: false, error: "Block list must not be empty." };
  }
  const blocks = validation.value;

  // Soft warning for unknown types — we still let the operator
  // apply, since a plugin reload after the paste may register
  // them. The reducer / renderer treat unknown types as no-ops
  // gracefully.
  const unknown = new Set<string>();
  const walk = (arr: NpBlockInstance[]): void => {
    for (const b of arr) {
      if (!known.has(b.type)) unknown.add(b.type);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  const warning =
    unknown.size > 0
      ? `Unknown block types will render as placeholders: ${Array.from(unknown).join(", ")}`
      : undefined;
  return { ok: true, parsed: blocks, warning };
}

export function PastePatternDialog({
  open,
  onOpenChange,
  knownTypes,
  onApply,
}: PastePatternDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <PastePatternDialogContent
          knownTypes={knownTypes}
          onApply={onApply}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function PastePatternDialogContent({
  knownTypes,
  onOpenChange,
  onApply,
}: Pick<PastePatternDialogProps, "knownTypes" | "onOpenChange" | "onApply">) {
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);

  const knownSet = new Set(knownTypes);

  const handleValidate = () => setResult(validate(raw, knownSet));

  const handleApply = () => {
    const validated = result ?? validate(raw, knownSet);
    if (!validated.ok || !validated.parsed) {
      setResult(validated);
      return;
    }
    const pattern: NpPattern = {
      id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: "Pasted blocks",
      source: "custom",
      blocks: validated.parsed,
    };
    onApply(pattern);
    onOpenChange(false);
  };

  return (
    <DialogContent className="min-w-0 max-w-2xl">
      <DialogHeader>
        <DialogTitle className="break-words">Paste blocks from JSON</DialogTitle>
        <DialogDescription className="break-words">
          Paste a single block, an array of blocks, or a pattern object. New ids are generated on
          insert so reuse never collides with existing rows.
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 gap-3">
        <Label
          htmlFor="np-paste-pattern-input"
          className="break-words text-xs uppercase tracking-wider"
        >
          JSON
        </Label>
        <Textarea
          id="np-paste-pattern-input"
          value={raw}
          onChange={(event) => {
            setRaw(event.currentTarget.value);
            setResult(null);
          }}
          rows={10}
          placeholder='[{"id":"…","type":"hero","props":{…}}]'
          className="min-w-0 font-mono text-xs"
        />
        {result?.error ? (
          <p className="break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {result.error}
          </p>
        ) : null}
        {result?.warning ? (
          <p className="break-words rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {result.warning}
          </p>
        ) : null}
        {result?.ok && result.parsed ? (
          <p className="break-words rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            Validated — {result.parsed.length} block
            {result.parsed.length === 1 ? "" : "s"} ready to insert.
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="ghost" onClick={handleValidate}>
          Validate
        </Button>
        <Button type="button" onClick={handleApply} disabled={raw.trim().length === 0}>
          Insert blocks
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

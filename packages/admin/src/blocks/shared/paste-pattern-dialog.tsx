"use client";

import { useEffect, useState } from "react";
import type { NpBlockInstance, NpPattern } from "@nexpress/blocks";

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
 * Validation surface (kept minimal — `INSERT_PATTERN`'s clone path
 * already drops bad shapes):
 *   1. valid JSON
 *   2. either an object (single block) or array of objects
 *   3. each block has string `id` + string `type`
 *
 * The looser shape than `PageJsonDialog`'s page-tree validation
 * (which knows the full tree contract) is intentional — a paste
 * snippet can come from anywhere, and warnings are friendlier
 * than hard rejects.
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Defensive shape check. Recurses into `children` so a paste with
 * a malformed deep node can't pass top-level validation only to
 * crash the reducer's `cloneBlockDeep` (which calls
 * `block.children.map(...)` — would throw on string / non-array).
 *
 * Rejects:
 *   - missing string `id` or `type`
 *   - `props` present but not a plain object
 *   - `children` present but not an array, or an array with any
 *     element that fails the same check
 */
function isBlockShape(value: unknown): value is NpBlockInstance {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || typeof value.type !== "string") {
    return false;
  }
  if (value.props !== undefined && !isPlainObject(value.props)) return false;
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) return false;
    for (const child of value.children) {
      if (!isBlockShape(child)) return false;
    }
  }
  return true;
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
  let blocks: NpBlockInstance[];
  if (Array.isArray(parsed)) {
    blocks = parsed.filter(isBlockShape);
    if (blocks.length === 0) {
      return { ok: false, error: "Array contained no valid block objects." };
    }
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { blocks?: unknown }).blocks)
  ) {
    const inner = (parsed as { blocks: unknown[] }).blocks.filter(isBlockShape);
    if (inner.length === 0) {
      return { ok: false, error: "Pattern's `blocks` array was empty or invalid." };
    }
    blocks = inner;
  } else if (isBlockShape(parsed)) {
    blocks = [parsed];
  } else {
    return {
      ok: false,
      error: "Top level must be a block, an array of blocks, or a pattern object.",
    };
  }

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
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);

  // Reset on open so a stale paste doesn't carry over between
  // invocations.
  useEffect(() => {
    if (open) {
      setRaw("");
      setResult(null);
    }
  }, [open]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
    </Dialog>
  );
}

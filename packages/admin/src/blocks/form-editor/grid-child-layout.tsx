"use client";

import type { NpBlockInstance } from "@nexpress/blocks";

import { Label } from "../../ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";

/**
 * Reads the `_layout` meta off a block's `props`. Centralizes the
 * defensive shape check in one place — block authors aren't
 * forced to type the meta carefully on every read.
 */
export function getLayout(
  props: Record<string, unknown>,
): Record<string, unknown> | null {
  const layout = props._layout;
  if (typeof layout === "object" && layout !== null && !Array.isArray(layout)) {
    return layout as Record<string, unknown>;
  }
  return null;
}

export interface GridChildLayoutControlProps {
  block: NpBlockInstance;
  inputId: string;
  onChange: (colSpan: number) => void;
}

/**
 * Column-span picker shown when a block sits directly inside a
 * `grid` container. The meta lives on the child's props as
 * `_layout: { colSpan }`. Form-editor specific UI — an in-page
 * editor would surface the same setting via inline column
 * handles, not a select dropdown.
 */
export function GridChildLayoutControl({
  block,
  inputId,
  onChange,
}: GridChildLayoutControlProps) {
  const layout = getLayout(block.props);
  const current =
    typeof layout?.colSpan === "number" && layout.colSpan >= 1 && layout.colSpan <= 12
      ? layout.colSpan
      : 12;
  return (
    <div className="grid gap-1.5 rounded-md border border-primary/20 bg-primary/5 p-3">
      <Label htmlFor={inputId} className="text-xs uppercase tracking-[0.18em] text-primary">
        Grid column span
      </Label>
      <div className="flex items-center gap-3">
        <Select value={String(current)} onValueChange={(v) => onChange(Number(v))}>
          <SelectTrigger id={inputId} className="h-9 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">of 12 columns</span>
      </div>
    </div>
  );
}

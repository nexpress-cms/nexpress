"use client";

import type { NpBlockInstance } from "@nexpress/blocks";

import { Label } from "../../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select.js";

/**
 * Reads the `_layout` meta off a block's `props`. Centralizes the
 * defensive shape check in one place — block authors aren't
 * forced to type the meta carefully on every read.
 */
export function getLayout(props: Record<string, unknown>): Record<string, unknown> | null {
  const layout = props._layout;
  if (typeof layout === "object" && layout !== null && !Array.isArray(layout)) {
    return layout as Record<string, unknown>;
  }
  return null;
}

type Breakpoint = "base" | "md" | "lg";

export interface GridChildLayoutControlProps {
  block: NpBlockInstance;
  inputId: string;
  /**
   * Patch a single breakpoint's column span on the child's
   * `_layout` meta. Pass `null` for `md` / `lg` to drop the
   * breakpoint override (the cell falls back through the CSS
   * cascade — lg → md → base). The base span is always present;
   * a `null` on base resets to the default 12.
   */
  onChange: (breakpoint: Breakpoint, value: number | null) => void;
}

const SPAN_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

function readSpan(
  layout: Record<string, unknown> | null,
  key: "colSpan" | "mdColSpan" | "lgColSpan",
): number | null {
  const value = layout?.[key];
  if (typeof value !== "number") return null;
  if (value < 1 || value > 12) return null;
  return Math.round(value);
}

/**
 * Column-span pickers shown when a block sits directly inside a
 * `grid` container. Three pickers — Mobile (base), Tablet (md, ≥
 * 768px), Desktop (lg, ≥ 1024px). Tablet / Desktop fall back
 * through the CSS cascade when unset, so an operator who only
 * cares about "half-width on tablet+" can leave the desktop value
 * at "auto" and the cell inherits the tablet span.
 */
export function GridChildLayoutControl({ block, inputId, onChange }: GridChildLayoutControlProps) {
  const layout = getLayout(block.props);
  const base = readSpan(layout, "colSpan") ?? 12;
  const md = readSpan(layout, "mdColSpan");
  const lg = readSpan(layout, "lgColSpan");

  return (
    <div className="grid gap-2 rounded-md border border-primary/20 bg-primary/5 p-3">
      <Label
        htmlFor={`${inputId}-base`}
        className="text-xs uppercase tracking-[0.18em] text-primary"
      >
        Grid column span
      </Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <BreakpointPicker
          inputId={`${inputId}-base`}
          label="Mobile"
          value={base}
          allowAuto={false}
          onChange={(v) => onChange("base", v)}
        />
        <BreakpointPicker
          inputId={`${inputId}-md`}
          label="Tablet"
          value={md}
          allowAuto={true}
          onChange={(v) => onChange("md", v)}
        />
        <BreakpointPicker
          inputId={`${inputId}-lg`}
          label="Desktop"
          value={lg}
          allowAuto={true}
          onChange={(v) => onChange("lg", v)}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Tablet / Desktop fall back through the cascade when set to Auto (Desktop → Tablet → Mobile).
      </p>
    </div>
  );
}

interface BreakpointPickerProps {
  inputId: string;
  label: string;
  value: number | null;
  allowAuto: boolean;
  onChange: (value: number | null) => void;
}

const AUTO_VALUE = "__np_auto__";

function BreakpointPicker({ inputId, label, value, allowAuto, onChange }: BreakpointPickerProps) {
  const selectValue = value === null ? AUTO_VALUE : String(value);
  return (
    <div className="grid gap-1">
      <Label
        htmlFor={inputId}
        className="text-[10px] uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </Label>
      <Select
        value={selectValue}
        onValueChange={(v) => onChange(v === AUTO_VALUE ? null : Number(v))}
      >
        <SelectTrigger id={inputId} className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowAuto ? <SelectItem value={AUTO_VALUE}>Auto</SelectItem> : null}
          {SPAN_OPTIONS.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} of 12
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

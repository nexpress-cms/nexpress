"use client";

import type { NpBlockInstance, NpBlockLayout } from "@nexpress/blocks";

import { Label } from "../../ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select.js";

type Breakpoint = "base" | "md" | "lg";

export interface GridChildLayoutControlProps {
  block: NpBlockInstance;
  inputId: string;
  defaultColSpan: number;
  /**
   * Replace the child's exact top-level layout metadata. An
   * undefined value means the default full-width layout.
   */
  onChange: (layout: NpBlockLayout | undefined) => void;
}

const SPAN_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

export function updateGridChildLayout(
  current: NpBlockLayout | undefined,
  breakpoint: Breakpoint,
  value: number | null,
  defaultColSpan = 12,
): NpBlockLayout | undefined {
  const next: NpBlockLayout = { ...(current ?? { colSpan: defaultColSpan }) };
  if (breakpoint === "base") {
    next.colSpan = value ?? defaultColSpan;
  } else if (breakpoint === "md") {
    if (value === null) delete next.mdColSpan;
    else next.mdColSpan = value;
  } else if (value === null) {
    delete next.lgColSpan;
  } else {
    next.lgColSpan = value;
  }

  return next.colSpan === defaultColSpan &&
    next.mdColSpan === undefined &&
    next.lgColSpan === undefined
    ? undefined
    : next;
}

/**
 * Column-span pickers shown when a block sits directly inside a
 * `grid` container. Three pickers — Mobile (base), Tablet (md, ≥
 * 768px), Desktop (lg, ≥ 1024px). Tablet / Desktop fall back
 * through the CSS cascade when unset, so an operator who only
 * cares about "half-width on tablet+" can leave the desktop value
 * at "auto" and the cell inherits the tablet span.
 */
export function GridChildLayoutControl({
  block,
  inputId,
  defaultColSpan,
  onChange,
}: GridChildLayoutControlProps) {
  const layout = block.layout;
  const base = layout?.colSpan ?? defaultColSpan;
  const md = layout?.mdColSpan ?? null;
  const lg = layout?.lgColSpan ?? null;

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
          onChange={(value) =>
            onChange(updateGridChildLayout(layout, "base", value, defaultColSpan))
          }
        />
        <BreakpointPicker
          inputId={`${inputId}-md`}
          label="Tablet"
          value={md}
          allowAuto={true}
          onChange={(value) => onChange(updateGridChildLayout(layout, "md", value, defaultColSpan))}
        />
        <BreakpointPicker
          inputId={`${inputId}-lg`}
          label="Desktop"
          value={lg}
          allowAuto={true}
          onChange={(value) => onChange(updateGridChildLayout(layout, "lg", value, defaultColSpan))}
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

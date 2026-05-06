"use client";

import type { ComponentProps } from "react";

import { cn } from "../../ui/utils.js";

import { EMOJI_TO_LUCIDE, LUCIDE_ICONS } from "./block-icon-registry.js";

/**
 * Renders the `icon` field on `NpBlockMetadata`. Three resolution
 * paths in order:
 *
 *   1. `kind === "emoji"` → render the string verbatim (plugin
 *      authors who want a glyph the framework hasn't aliased).
 *   2. `LUCIDE_ICONS[icon]` → curated Lucide-name lookup (the
 *      framework's built-in blocks set `iconKind: "lucide"` and
 *      put the name in `icon`).
 *   3. `EMOJI_TO_LUCIDE[icon]` → back-compat alias for un-migrated
 *      plugin / theme blocks. A `📝` becomes `<FileText />` for
 *      free without API churn.
 *   4. Fallback — render the string as text. Keeps unknown glyphs
 *      from disappearing entirely.
 *
 * The wrapping span enforces a fixed visual footprint so emoji
 * fallbacks line up with Lucide SVGs in the same row.
 */
export interface BlockIconProps extends Omit<ComponentProps<"span">, "children"> {
  icon?: string;
  kind?: "lucide" | "emoji";
  /** Tailwind size class — defaults to `h-4 w-4` (16 px). */
  sizeClassName?: string;
}

export function BlockIcon({
  icon,
  kind,
  sizeClassName = "h-4 w-4",
  className,
  ...spanProps
}: BlockIconProps) {
  if (!icon) return null;

  if (kind === "emoji") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center text-base leading-none",
          sizeClassName,
          className,
        )}
        {...spanProps}
      >
        {icon}
      </span>
    );
  }

  const Resolved = LUCIDE_ICONS[icon] ?? EMOJI_TO_LUCIDE[icon];
  if (Resolved) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center",
          sizeClassName,
          className,
        )}
        {...spanProps}
      >
        <Resolved className={sizeClassName} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-base leading-none",
        sizeClassName,
        className,
      )}
      {...spanProps}
    >
      {icon}
    </span>
  );
}

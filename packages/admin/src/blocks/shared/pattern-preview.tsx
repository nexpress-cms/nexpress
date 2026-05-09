"use client";

import { useState } from "react";
import { LayoutGrid } from "lucide-react";

import { cn } from "../../ui/utils.js";

/**
 * Phase F.5.2 — pattern preview thumbnail with broken-image
 * fallback.
 *
 * Theme authors ship preview images by URL on
 * `NpPattern.preview`. Convention (documented on the type):
 *
 *   `/themes/<theme-id>/patterns/<pattern-id>.png`
 *
 * served from the theme package's `public/` so Next.js serves
 * it directly. But preview URLs come from theme code we don't
 * control, so this component:
 *
 *   - Renders the image with `loading="lazy"` (panels with many
 *     patterns don't bulk-fetch).
 *   - Catches `onError` and falls back to a labeled icon tile
 *     so the picker stays usable when a theme ships a 404
 *     preview path.
 *   - When `src` is omitted, renders the same fallback. Built-in
 *     patterns / custom (operator-saved) patterns don't have
 *     thumbnails today; rendering a "no preview" tile is
 *     visually consistent with the rest of the picker grid.
 */
export interface PatternPreviewProps {
  src?: string;
  alt: string;
  /** "thumb" — small inline (e.g. command-menu): 24×36px.
   *  "card" — large grid tile (e.g. pattern library): aspect
   *  16:10 fluid width. */
  size: "thumb" | "card";
  className?: string;
}

export function PatternPreview({
  src,
  alt,
  size,
  className,
}: PatternPreviewProps) {
  // `errored` flips when the actual image fails to load. Using
  // local state (not a key swap) means the fallback path doesn't
  // re-mount the component when the picker filters/re-renders —
  // important for grid views with many tiles.
  const [errored, setErrored] = useState(false);

  const showFallback = !src || errored;

  const sizeClass =
    size === "card"
      ? "aspect-[16/10] w-full"
      : "h-6 w-9 shrink-0";

  if (showFallback) {
    return (
      <div
        aria-label={alt}
        role="img"
        className={cn(
          sizeClass,
          "flex items-center justify-center rounded-sm border border-border/40 bg-muted/40 text-muted-foreground",
          className,
        )}
      >
        <LayoutGrid
          className={size === "card" ? "h-6 w-6" : "h-3 w-3"}
          aria-hidden
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setErrored(true)}
      className={cn(
        sizeClass,
        "rounded-sm border border-border/40 object-cover",
        className,
      )}
    />
  );
}

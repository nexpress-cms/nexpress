import * as React from "react";

import { Badge } from "./badge.js";
import { cn } from "./utils.js";

export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral" | "muted";

interface StatusDotProps {
  tone?: StatusTone;
  className?: string;
}

const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  info: "bg-sky-500",
  danger: "bg-red-600",
  neutral: "bg-neutral-400",
  muted: "bg-neutral-300",
};

/**
 * 6×6 colored dot used inside `StatusBadge` (and anywhere the design
 * needs a quiet "live state" indicator). Color is the only carrier
 * of meaning; the surrounding label remains the source of truth for
 * accessibility, so the dot is `aria-hidden`.
 */
export function StatusDot({ tone = "neutral", className }: StatusDotProps) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", TONE_CLASS[tone], className)}
    />
  );
}

interface StatusBadgeMapping {
  variant: "default" | "secondary" | "outline" | "destructive" | "brand";
  label: string;
  tone: StatusTone;
}

const DEFAULT_STATUS_MAP: Record<string, StatusBadgeMapping> = {
  published: { variant: "default", label: "Published", tone: "success" },
  draft: { variant: "secondary", label: "Draft", tone: "neutral" },
  scheduled: { variant: "outline", label: "Scheduled", tone: "info" },
  review: { variant: "outline", label: "In review", tone: "warning" },
  pending: { variant: "outline", label: "Pending", tone: "warning" },
  archived: { variant: "secondary", label: "Archived", tone: "neutral" },
  active: { variant: "outline", label: "Active", tone: "success" },
  unverified: { variant: "outline", label: "Unverified", tone: "warning" },
  banned: { variant: "outline", label: "Banned", tone: "danger" },
  suspended: { variant: "outline", label: "Suspended", tone: "warning" },
  deleted: { variant: "outline", label: "Deleted", tone: "muted" },
  open: { variant: "outline", label: "Open", tone: "danger" },
  resolved: { variant: "outline", label: "Resolved", tone: "success" },
  dismissed: { variant: "outline", label: "Dismissed", tone: "muted" },
  live: { variant: "default", label: "Live", tone: "success" },
  staging: { variant: "secondary", label: "Staging", tone: "warning" },
};

interface StatusBadgeProps {
  status: string;
  /** Override the default tone/variant mapping for a specific row. */
  override?: Partial<StatusBadgeMapping>;
  className?: string;
}

/**
 * Status pill with a colored dot — the design system's canonical
 * "what state is this in" marker. Falls back to a neutral `Draft`
 * mapping for unknown statuses so callers don't have to guard.
 */
export function StatusBadge({ status, override, className }: StatusBadgeProps) {
  const fallback: StatusBadgeMapping = DEFAULT_STATUS_MAP[status.toLowerCase()] ?? {
    variant: "secondary",
    label: status,
    tone: "neutral",
  };
  const mapping = { ...fallback, ...override };

  return (
    <Badge variant={mapping.variant} className={className}>
      <StatusDot tone={mapping.tone} />
      {mapping.label}
    </Badge>
  );
}

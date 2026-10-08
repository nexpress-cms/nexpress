import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, CardContent } from "@nexpress/admin/client";

import type { AdminOpsState } from "../../lib/admin-ops";

export function SummaryStat({
  label,
  value,
  helper,
  state,
}: {
  label: string;
  value: string;
  helper: string;
  state: AdminOpsState;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="min-w-0">
        <p className="break-words text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
          {label}
        </p>
        <p
          className={`mt-3 break-words text-[24px] font-semibold leading-none ${toneTextClass(state)}`}
        >
          {value}
        </p>
        <p className="mt-1 break-words text-[12px] text-neutral-500 dark:text-neutral-400">
          {helper}
        </p>
      </CardContent>
    </Card>
  );
}

export function StateBadge({ state }: { state: AdminOpsState }) {
  const variant = state === "error" ? "destructive" : state === "warn" ? "outline" : "brand";
  return (
    <Badge variant={variant} className="shrink-0 uppercase tracking-[0.06em]">
      {state === "error" ? "Blocked" : state === "warn" ? "Attention" : "Ready"}
    </Badge>
  );
}

export function LinkButton({
  href,
  variant,
  className,
  children,
}: {
  href: string;
  variant: LinkButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={linkButtonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function AnchorButton({
  href,
  variant,
  className,
  download,
  children,
}: {
  href: string;
  variant: LinkButtonVariant;
  className?: string;
  download?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} download={download} className={linkButtonClass(variant, className)}>
      {children}
    </a>
  );
}

type LinkButtonVariant = "default" | "outline" | "ghost";

function linkButtonClass(variant: LinkButtonVariant, className?: string): string {
  const base =
    "inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12.5px] font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] sm:h-7 sm:px-2.5";
  const styles: Record<LinkButtonVariant, string> = {
    default:
      "bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200",
    outline:
      "border border-neutral-200/80 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-50 dark:hover:bg-neutral-900",
    ghost:
      "text-neutral-700 hover:bg-neutral-950/[0.045] hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/[0.05] dark:hover:text-white",
  };

  return [base, styles[variant], className].filter(Boolean).join(" ");
}

export function toneTextClass(state: AdminOpsState): string {
  if (state === "error") return "text-red-600 dark:text-red-400";
  if (state === "warn") return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

export function dotClass(state: AdminOpsState): string {
  if (state === "error") return "bg-red-600";
  if (state === "warn") return "bg-amber-500";
  return "bg-emerald-500";
}

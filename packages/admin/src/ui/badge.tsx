import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-[11.5px] font-medium transition-colors focus:outline-none focus:ring-[3px] focus:ring-[var(--np-color-brand-ring)]",
  {
    variants: {
      variant: {
        default:
          "bg-neutral-950/[0.045] text-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200",
        secondary:
          "bg-neutral-950/[0.035] text-neutral-700 dark:bg-white/[0.04] dark:text-neutral-300",
        destructive: "bg-red-100/60 text-red-700 dark:bg-red-500/15 dark:text-red-300",
        outline:
          "border-neutral-200/80 bg-white text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300",
        brand: "bg-[color:var(--np-color-brand-soft)] text-[var(--np-color-brand)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

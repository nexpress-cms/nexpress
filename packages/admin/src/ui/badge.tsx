import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-950/10 focus:ring-offset-2 dark:focus:ring-white/10",
  {
    variants: {
      variant: {
        default: "border-transparent bg-neutral-950 text-white dark:bg-white dark:text-neutral-950",
        secondary:
          "border-transparent bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100",
        destructive: "border-transparent bg-red-600 text-white dark:bg-red-500",
        outline: "border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

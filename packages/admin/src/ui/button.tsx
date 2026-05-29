import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-medium tracking-[-0.005em] transition-colors duration-150 outline-none ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)]",
  {
    variants: {
      variant: {
        default:
          "bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200",
        brand:
          "bg-[var(--np-color-brand)] text-white hover:bg-[#0052d6]",
        destructive:
          "bg-red-600 text-white hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400",
        outline:
          "border border-neutral-200/80 bg-white text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-50 dark:hover:bg-neutral-900",
        ghost:
          "text-neutral-700 hover:bg-neutral-950/[0.045] hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/[0.05] dark:hover:text-white",
        link: "text-[var(--np-color-brand)] underline-offset-[3px] hover:underline px-0 h-auto",
      },
      size: {
        default: "h-10 px-3 sm:h-8",
        sm: "h-10 rounded-md px-3 text-[12.5px] sm:h-7 sm:px-2.5",
        lg: "h-11 px-4 text-[13.5px] sm:h-9",
        icon: "size-10 px-0 sm:size-8",
        "icon-sm": "size-10 rounded-md px-0 sm:size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

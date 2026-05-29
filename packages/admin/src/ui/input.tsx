import * as React from "react";

import { cn } from "./utils.js";

const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-lg border border-neutral-200/80 bg-white px-3 text-[13px] text-neutral-950 transition-colors outline-none file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-neutral-950 placeholder:text-neutral-400 focus-visible:border-[var(--np-color-brand)] focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:file:text-neutral-50 dark:placeholder:text-neutral-500 sm:h-8 sm:px-2.5",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };

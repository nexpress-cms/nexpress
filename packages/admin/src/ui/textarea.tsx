import * as React from "react";

import { cn } from "./utils.js";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-20 w-full rounded-lg border border-neutral-200/80 bg-white px-2.5 py-2 text-[13px] leading-[1.5] text-neutral-950 transition-colors outline-none placeholder:text-neutral-400 focus-visible:border-[var(--np-color-brand)] focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:placeholder:text-neutral-500",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };

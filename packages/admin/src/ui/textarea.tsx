import * as React from "react";

import { cn } from "./utils.js";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-24 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-950 shadow-sm transition-colors outline-none placeholder:text-neutral-500 focus-visible:border-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-950/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:placeholder:text-neutral-400 dark:focus-visible:border-neutral-700 dark:focus-visible:ring-white/10",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };

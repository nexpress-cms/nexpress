import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "./utils.js";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-xl border border-neutral-200/80 bg-white p-3.5 text-[13px] text-neutral-950 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.18),0_8px_16px_-8px_rgba(0,0,0,0.08)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 dark:border-neutral-800/80 dark:bg-neutral-950 dark:text-neutral-50",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverContent, PopoverTrigger };

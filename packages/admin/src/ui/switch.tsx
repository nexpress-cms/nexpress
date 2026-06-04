import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "./utils.js";

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-10 w-14 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-neutral-300 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--np-color-brand)] dark:bg-neutral-700 sm:h-[18px] sm:w-8",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-6 rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-1 sm:size-3.5 sm:data-[state=checked]:translate-x-3.5 sm:data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "./utils.js";

const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-[12.5px] font-medium leading-none text-neutral-800 peer-disabled:cursor-not-allowed peer-disabled:opacity-70 dark:text-neutral-200",
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };

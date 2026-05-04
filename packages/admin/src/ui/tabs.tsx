import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "./utils.js";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-neutral-100 p-1 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium ring-offset-background transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nx-color-brand-ring)] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-white data-[state=active]:text-neutral-950 data-[state=active]:shadow-sm dark:data-[state=active]:bg-neutral-950 dark:data-[state=active]:text-neutral-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-neutral-950/10 focus-visible:ring-offset-2 dark:focus-visible:ring-white/10",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };

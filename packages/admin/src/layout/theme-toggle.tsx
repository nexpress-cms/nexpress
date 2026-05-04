"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "../ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../ui/utils.js";

/**
 * Three-way theme toggle: system → light → dark → system.
 *
 *   - "system"  reads `prefers-color-scheme` and updates live when
 *               the OS toggles (Mac auto / Windows night light / etc.)
 *   - "light"   force-removes the .dark class
 *   - "dark"    force-adds the .dark class
 *
 * Persisted to `localStorage` under the key `nx-theme`. The matching
 * <ThemeInit /> component runs an inline <script> on first paint so
 * the operator never sees a flash of the wrong palette.
 */

const STORAGE_KEY = "nx-theme";
type Mode = "system" | "light" | "dark";

function readMode(): Mode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyMode(mode: Mode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element {
  const [mode, setMode] = React.useState<Mode>("system");

  // Hydrate from localStorage on mount, and keep the .dark class in
  // sync with the OS preference when mode === "system".
  React.useEffect(() => {
    setMode(readMode());
  }, []);

  React.useEffect(() => {
    applyMode(mode);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyMode("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  function cycle() {
    const next: Mode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    setMode(next);
    if (typeof window !== "undefined") {
      if (next === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    }
  }

  const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
  const label =
    mode === "system" ? "Theme: system" : mode === "light" ? "Theme: light" : "Theme: dark";

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={cycle}
      aria-label={label}
      className={cn("rounded-full", collapsed && "size-8")}
    >
      <Icon className="size-3.5" />
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{label} (click to cycle)</TooltipContent>
    </Tooltip>
  );
}

/**
 * Inline-script primitive that runs before React hydrates. Render it
 * in the admin route group's layout (server component) so the right
 * .dark class is on <html> at the very first paint — no FOUC on
 * navigation between site / admin shells.
 */
export function ThemeInit(): React.JSX.Element {
  // The script body has to stay self-contained and synchronous; React
  // only emits this on the SSR pass and the browser executes it as
  // soon as it's parsed.
  const script = `
(function() {
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: script }} suppressHydrationWarning />;
}

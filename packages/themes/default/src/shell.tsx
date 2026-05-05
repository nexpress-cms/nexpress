import { NpColorSchemeScript } from "@nexpress/theme";
import type { ReactNode } from "react";

import type { NpThemeShellProps } from "@nexpress/theme";

/**
 * Default theme shell — wraps every (site) route. The shell
 * also owns this theme's color-mode policy: it mounts
 * `<NpColorSchemeScript />` so the saved `np-color-scheme`
 * cookie / `prefers-color-scheme` choice is applied to
 * `<html data-theme="…">` before first paint, and the dark
 * variants ride on the rules in `defaultThemeCss`.
 *
 * Dark mode is no longer auto-wired by the framework — every
 * theme decides whether to ship light/dark switching, what
 * tokens it flips, and how the toggle UX looks. Themes that
 * want a different policy (no dark mode, time-of-day,
 * seasonal palette, …) simply omit this script and the
 * dark CSS overrides.
 */
export function DefaultShell({ children }: NpThemeShellProps): ReactNode {
  return (
    <>
      <NpColorSchemeScript />
      {children}
    </>
  );
}

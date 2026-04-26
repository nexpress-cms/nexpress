import type { ReactNode } from "react";

import type { NxThemeShellProps } from "@nexpress/theme";

/**
 * Default theme shell — renders the document chrome around
 * every (site) route. Mirrors what `apps/web/src/app/(site)/
 * layout.tsx` did pre-Phase 11.1 (header → main → footer)
 * but the actual header / footer pieces live in their own
 * slot components so themes can selectively override one
 * without re-implementing the whole shell.
 *
 * Phase 11.2 will wire this up — until then the apps/web
 * layout still calls these components directly.
 */
export function DefaultShell({ children }: NxThemeShellProps): ReactNode {
  return <>{children}</>;
}

import * as React from "react";
import type { NpThemeShellProps } from "@nexpress/theme";

/**
 * Phase F.9-B — docs theme shell.
 *
 * Body grid: header on top, then a 3-column row of sidebar +
 * main + (optional) TOC. The sidebar slot reads the docs
 * collection hierarchy; main is the page render; TOC is left
 * to the page template (it knows which headings the doc has).
 */
export function DocsShell({ children }: NpThemeShellProps): React.ReactElement {
  return (
    <div className="np-docs-shell">
      <div className="np-docs-grid">{children}</div>
    </div>
  );
}

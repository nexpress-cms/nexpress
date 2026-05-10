import type { ReactNode } from "react";

import { DocsHeader } from "./header.js";

/**
 * Docs theme's member-tree shell.
 *
 * Drops the docs sidebar (which is hierarchical-doc navigation —
 * useless on auth forms) and renders a narrow column under the
 * masthead. Reuses `DocsHeader` directly so a masthead bump
 * cascades to member pages — single source of truth for chrome.
 *
 * Skips the public `DocsShell`'s 3-column grid because the
 * `<ShellWrap surface="member">` fallback chain only invokes
 * `impl.members.shell` (this component); the public shell never
 * wraps the member tree.
 */
export function DocsMembersShell({ children }: { children: ReactNode }) {
  return (
    <div className="np-docs np-docs-shell">
      <DocsHeader />
      <div className="np-docs-members">
        <div className="np-docs-members-column">{children}</div>
      </div>
    </div>
  );
}

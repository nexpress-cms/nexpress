import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Page template with a sticky sidebar on the right. Suited to
 * documentation / knowledge-base pages — the main column carries
 * the body, the aside carries supporting links / version pickers
 * / contributor cards.
 *
 * The aside is sourced from `doc.sidebar` (free-form blocks) when
 * present; sites that don't model a sidebar field on their pages
 * collection just see the main column. We keep the aside slot
 * always-rendered (with a fallback "On this page" placeholder) so
 * the layout doesn't reflow when an editor toggles the field.
 */
export function PageSidebarTemplate({ doc }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const sidebar = (doc as { sidebar?: NpPageBlocks }).sidebar;
  const title = (doc as { title?: string }).title ?? "Untitled";

  return (
    <div className="np-page np-page-sidebar">
      <article className="np-page-sidebar-main">
        {blocks ? renderBlocks(blocks) : <h1>{title}</h1>}
      </article>
      <aside className="np-page-sidebar-aside" aria-label="Page sidebar">
        {sidebar && sidebar.length > 0 ? (
          renderBlocks(sidebar)
        ) : (
          <div className="np-page-sidebar-placeholder">
            <p className="np-page-sidebar-placeholder-label">On this page</p>
            <p className="np-page-sidebar-placeholder-hint">
              Add a <code>sidebar</code> field to your pages collection to fill
              this column with secondary blocks.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

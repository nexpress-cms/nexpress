import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Project detail template. Big hero image, large title, optional
 * meta strip (role / year / client), then content blocks. The
 * content area uses a max-width column so prose stays readable
 * even on the dark surface; image blocks inside the body still
 * render edge-to-edge thanks to a nested full-bleed override.
 */
interface ProjectDoc {
  title?: string;
  excerpt?: string;
  cover?: { url?: string; alt?: string } | string | null;
  role?: string;
  year?: string | number;
  client?: string;
  blocks?: NpPageBlocks;
}

function coverUrl(value: ProjectDoc["cover"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.url ?? null;
}

function coverAlt(value: ProjectDoc["cover"], fallback: string): string {
  if (value && typeof value === "object" && value.alt) return value.alt;
  return fallback;
}

export function ProjectDetailTemplate({ doc }: NpTemplateRenderProps) {
  const project = doc as ProjectDoc;
  const title = project.title ?? "Untitled";
  const cover = coverUrl(project.cover);
  return (
    <article className="nx-portfolio-project-detail">
      {cover ? (
        <figure className="nx-portfolio-project-hero">
          <img src={cover} alt={coverAlt(project.cover, title)} />
        </figure>
      ) : null}
      <header className="nx-portfolio-project-header">
        <h1>{title}</h1>
        {project.excerpt ? (
          <p className="nx-portfolio-project-excerpt">{project.excerpt}</p>
        ) : null}
        {(project.role || project.year || project.client) ? (
          <dl className="nx-portfolio-project-meta">
            {project.client ? (
              <>
                <dt>Client</dt>
                <dd>{project.client}</dd>
              </>
            ) : null}
            {project.role ? (
              <>
                <dt>Role</dt>
                <dd>{project.role}</dd>
              </>
            ) : null}
            {project.year ? (
              <>
                <dt>Year</dt>
                <dd>{String(project.year)}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </header>
      {project.blocks && project.blocks.length > 0 ? (
        <div className="nx-portfolio-project-body">
          {renderBlocks(project.blocks)}
        </div>
      ) : null}
    </article>
  );
}

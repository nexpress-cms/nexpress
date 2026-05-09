import * as React from "react";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import {
  PortfolioProjectCard,
  type PortfolioProjectDoc,
} from "../components/project-card.js";
import { resolvePortfolioSettings } from "../settings-helpers.js";

/**
 * Project-index template. Big square cards in a responsive grid.
 * Title + intro centered above. The grid collapses to one column
 * below ~640px.
 *
 * Phase F.9.1-A — `settings.gridColumns` (1–6) drives the grid
 * column count via inline `gridTemplateColumns`. Default is 3.
 * `settings.galleryGutter` drives the gap between cards.
 *
 * Doc shape: `{ docs: PortfolioProjectDoc[], heading?, intro? }`.
 */
interface IndexDoc {
  docs?: PortfolioProjectDoc[];
  heading?: string;
  intro?: string;
}

export async function ProjectIndexTemplate({
  doc,
}: NpTemplateRenderProps): Promise<React.ReactElement> {
  const data = doc as IndexDoc;
  const settings = await resolvePortfolioSettings();
  const heading = data.heading ?? "Selected work";
  const intro = data.intro;
  const docs = data.docs ?? [];
  // Pass settings as CSS custom properties — the styles.ts
  // media queries clamp the column count at narrower viewports
  // so a `gridColumns: 6` setting doesn't crush content on
  // mobile. Inline `gridTemplateColumns` would beat the media
  // queries; vars let CSS stay in control of breakpoints.
  const gridStyle = {
    "--np-portfolio-grid-cols": settings.gridColumns,
    "--np-portfolio-grid-gutter": `${settings.galleryGutter}px`,
  } as React.CSSProperties;
  return (
    <section className="np-portfolio-index">
      <header className="np-portfolio-index-header">
        <h1>{heading}</h1>
        {intro ? <p>{intro}</p> : null}
      </header>
      {docs.length === 0 ? (
        <p className="np-portfolio-index-empty">
          Nothing on display yet. Add projects from the admin to fill the grid.
        </p>
      ) : (
        <div className="np-portfolio-index-grid" style={gridStyle}>
          {docs.map((project) => (
            <PortfolioProjectCard
              key={project.id ?? project.slug ?? project.title}
              doc={project}
            />
          ))}
        </div>
      )}
    </section>
  );
}

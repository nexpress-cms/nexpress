import type { NpTemplateRenderProps } from "@nexpress/theme";

import {
  PortfolioProjectCard,
  type PortfolioProjectDoc,
} from "../components/project-card.js";

/**
 * Project-index template. Big square cards in a 2- / 3-column
 * responsive grid. Title + intro centered above. The grid
 * collapses to one column below ~640px.
 *
 * Doc shape: `{ docs: PortfolioProjectDoc[], heading?, intro? }`.
 */
interface IndexDoc {
  docs?: PortfolioProjectDoc[];
  heading?: string;
  intro?: string;
}

export function ProjectIndexTemplate({ doc }: NpTemplateRenderProps) {
  const data = doc as IndexDoc;
  const heading = data.heading ?? "Selected work";
  const intro = data.intro;
  const docs = data.docs ?? [];
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
        <div className="np-portfolio-index-grid">
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

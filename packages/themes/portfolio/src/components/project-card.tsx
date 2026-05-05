/**
 * Portfolio "project" card. Visual-first: a large image (1:1
 * by default) with an overlaid title that fades in on hover.
 * Defensive on the doc shape so collections of any kind can
 * be routed through this card.
 */

export interface PortfolioProjectDoc {
  id?: string;
  slug?: string;
  title?: string;
  category?: string;
  cover?: { url?: string; alt?: string } | string | null;
}

function coverUrl(value: PortfolioProjectDoc["cover"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.url ?? null;
}

function coverAlt(value: PortfolioProjectDoc["cover"], fallback: string): string {
  if (value && typeof value === "object" && value.alt) return value.alt;
  return fallback;
}

function projectHref(doc: PortfolioProjectDoc): string {
  if (doc.slug) {
    return doc.slug.startsWith("/") ? doc.slug : `/work/${doc.slug}`;
  }
  return "#";
}

export interface PortfolioProjectCardProps {
  doc: PortfolioProjectDoc;
}

export function PortfolioProjectCard({ doc }: PortfolioProjectCardProps) {
  const href = projectHref(doc);
  const cover = coverUrl(doc.cover);
  const title = doc.title ?? "Untitled";
  return (
    <a href={href} className="np-portfolio-project-card">
      <figure className="np-portfolio-project-cover">
        {cover ? (
          <img src={cover} alt={coverAlt(doc.cover, title)} loading="lazy" />
        ) : (
          <span className="np-portfolio-project-placeholder" aria-hidden="true" />
        )}
        <figcaption className="np-portfolio-project-caption">
          <span className="np-portfolio-project-title">{title}</span>
          {doc.category ? (
            <span className="np-portfolio-project-category">{doc.category}</span>
          ) : null}
        </figcaption>
      </figure>
    </a>
  );
}

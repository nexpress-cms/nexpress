import * as React from "react";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import type { PortfolioProjectDoc } from "../components/project-card.js";
import { resolvePortfolioSettings } from "../settings-helpers.js";

/**
 * Project index — the portfolio site's front page.
 *
 *   1. **Hero** — eyebrow with accent-dot + display-italic
 *      headline + three meta blocks (What we do / Selected
 *      clients / Recognition).
 *   2. **Controls strip** — filter tablist (All / Identity /
 *      Typography / Editorial / Packaging) + grid/list view
 *      toggle. Filter state is server-side (URL query); the
 *      toggle is decorative in v0.1 (no client island).
 *   3. **Asymmetric 12-column grid** — projects render as cards
 *      with `span-N` modifiers that cycle through 7-5-4-4-8-6-
 *      6-12 unless a doc carries an explicit `span` field.
 *      Cover art uses the doc's `cover` URL when set; otherwise
 *      falls back to one of the 8 gradient swatches with a
 *      monogram derived from the project name.
 *   4. **Studio strip** — eyebrow + display headline + body
 *      paragraphs + 2×2 stats grid. Body + stats come from the
 *      doc; the headline is editorial.
 *   5. **Contact strip** — eyebrow + large mailto link + meta
 *      links. Hidden when `settings.contactEmail` is unset.
 *
 * Doc shape extends `{ docs, heading?, intro? }` with optional
 * hero / studio / contact slots. Routes that don't pass them
 * fall back to the design defaults so the demo renders cleanly
 * on a fresh install.
 */

interface MetaBlock {
  label: string;
  value: string;
}

interface StudioStat {
  value: string;
  label: string;
}

interface IndexDoc {
  docs?: PortfolioProjectDoc[];
  /** Hero eyebrow text (rendered after the small accent dot). */
  heroEyebrow?: string;
  /** Hero headline. Supports `<em>...</em>` for the italic-accent runs. */
  heading?: string;
  /** Three meta blocks under the hero rule. Best at exactly 3. */
  heroMeta?: MetaBlock[];
  /** Filter tablist. `active: true` marks the current filter. */
  filters?: Array<{ label: string; href?: string; count?: number; active?: boolean }>;
  /** Top-level page intro (rarely used — hero meta carries most of this). */
  intro?: string;
  /** Studio strip: eyebrow + headline + body paragraphs + stats grid. */
  studioEyebrow?: string;
  studioHeading?: string;
  studioBody?: string[];
  studioStats?: StudioStat[];
  /** Hide the studio strip entirely. */
  hideStudio?: boolean;
  /** Hide the contact strip entirely. */
  hideContact?: boolean;
}

/**
 * Cover-gradient cycle. Cards without an image cover get a
 * swatch from `a` through `h` in order, so the grid reads as a
 * mosaic rather than a wall of identical placeholders.
 */
const COVER_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/**
 * Default span pattern for the first 9 cards — mirrors the
 * design's 7-5-4-4-8-6-6-12 mosaic. Cards beyond index 8 fall
 * back to span-6 (a regular two-per-row layout).
 */
const SPAN_PATTERN = [7, 5, 4, 4, 4, 8, 6, 6, 12] as const;

function spanForIndex(doc: PortfolioProjectDoc, index: number): 4 | 5 | 6 | 7 | 8 | 12 {
  const explicit = (doc as { span?: unknown }).span;
  if (
    explicit === 4 ||
    explicit === 5 ||
    explicit === 6 ||
    explicit === 7 ||
    explicit === 8 ||
    explicit === 12
  ) {
    return explicit;
  }
  return (SPAN_PATTERN[index] ?? 6) as 4 | 5 | 6 | 7 | 8 | 12;
}

function coverClass(doc: PortfolioProjectDoc, index: number): string {
  const explicit = (doc as { coverVariant?: unknown }).coverVariant;
  if (typeof explicit === "string" && /^[a-h]$/.test(explicit)) {
    return `np-portfolio-cover-${explicit}`;
  }
  const letter = COVER_LETTERS[index % COVER_LETTERS.length]!;
  return `np-portfolio-cover-${letter}`;
}

function coverFigure(doc: PortfolioProjectDoc): string {
  if (typeof (doc as { coverFigure?: unknown }).coverFigure === "string") {
    return (doc as { coverFigure: string }).coverFigure;
  }
  const title = doc.title ?? "";
  // Strip non-letters, take first 2 chars, capitalize the first.
  const letters = title.replace(/[^a-zA-Z]/g, "").slice(0, 2);
  if (letters.length === 0) return "•";
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

function projectHref(doc: PortfolioProjectDoc): string {
  if (doc.slug) {
    return doc.slug.startsWith("/") ? doc.slug : `/projects/${doc.slug}`;
  }
  return "#";
}

function disciplineParts(doc: PortfolioProjectDoc): string[] {
  const raw = (doc as { discipline?: unknown }).discipline;
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  if (typeof raw === "string") return raw.split(/\s*[·,]\s*/).filter(Boolean);
  return [];
}

function projectYear(doc: PortfolioProjectDoc): string | null {
  const year = (doc as { year?: unknown }).year;
  if (typeof year === "number") return year.toString();
  if (typeof year === "string") return year;
  if (doc.publishedAt) {
    try {
      const d =
        typeof doc.publishedAt === "string"
          ? new Date(doc.publishedAt)
          : doc.publishedAt;
      if (!Number.isNaN(d.getTime())) return d.getFullYear().toString();
    } catch {
      // fall through
    }
  }
  return null;
}

function renderHeadlineWithEm(text: string): React.ReactNode {
  // Allow operator-authored `<em>...</em>` runs in the hero
  // headline — they pick up the accent color via CSS.
  // Restricted to `<em>` only so the template doesn't run
  // arbitrary HTML.
  const parts = text.split(/(<em>[^<]*<\/em>)/g);
  return parts.map((part, i) => {
    const m = /^<em>([^<]*)<\/em>$/.exec(part);
    if (m) {
      return <em key={`em-${i.toString()}`}>{m[1]}</em>;
    }
    return <React.Fragment key={`t-${i.toString()}`}>{part}</React.Fragment>;
  });
}

export async function ProjectIndexTemplate({
  doc,
}: NpTemplateRenderProps): Promise<React.ReactElement> {
  const data = doc as IndexDoc;
  const settings = await resolvePortfolioSettings();
  const docs = data.docs ?? [];
  const heroEyebrow = data.heroEyebrow ?? "Selected work — 2018 — 2026";
  const heading = data.heading ?? "A small studio for <em>identity, type,</em> and the long view of a brand.";
  const heroMeta: MetaBlock[] = data.heroMeta ?? [];
  const filters = data.filters ?? [];
  const studioEyebrow = data.studioEyebrow ?? "The studio";
  const studioHeading = data.studioHeading;
  const studioBody = data.studioBody ?? [];
  const studioStats = data.studioStats ?? [];
  const contactHref = settings.contactEmail
    ? `mailto:${settings.contactEmail}`
    : null;

  return (
    <>
      {/* Hero */}
      <section className="np-portfolio-hero">
        <div className="np-portfolio-container">
          <p className="np-portfolio-hero-eyebrow">
            <span
              className="np-portfolio-hero-eyebrow-dot"
              aria-hidden="true"
            />
            {heroEyebrow}
          </p>
          <h1>{renderHeadlineWithEm(heading)}</h1>
          {data.intro ? (
            <p
              style={{
                fontStyle: "italic",
                color: "var(--np-color-muted-foreground)",
                margin: "0 0 1.5rem",
                maxWidth: "42rem",
                fontSize: "1.125rem",
                lineHeight: 1.55,
              }}
            >
              {data.intro}
            </p>
          ) : null}
          {heroMeta.length > 0 ? (
            <div className="np-portfolio-hero-meta">
              {heroMeta.map((block, i) => (
                <div key={`hero-meta-${i.toString()}`}>
                  <p className="np-portfolio-hero-meta-block-label">
                    {block.label}
                  </p>
                  <p className="np-portfolio-hero-meta-block-value">
                    {block.value}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* Controls + grid */}
      <section className="np-portfolio-container">
        {filters.length > 0 ? (
          <div className="np-portfolio-controls">
            <ul className="np-portfolio-filters" role="tablist">
              {filters.map((f, i) => (
                <li key={`filter-${i.toString()}-${f.label}`}>
                  <a
                    href={f.href ?? "#"}
                    data-active={f.active ? "true" : undefined}
                  >
                    {f.label}
                    {typeof f.count === "number" ? (
                      <sup>{f.count.toString()}</sup>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
            <div className="np-portfolio-view">
              <span>
                {docs.length > 0
                  ? `${(latestYear(docs) ?? "—").toString()} — ${(oldestYear(docs) ?? "—").toString()} ·`
                  : ""}
              </span>
              <div className="np-portfolio-view-toggle" role="group">
                <button
                  type="button"
                  aria-pressed="true"
                  aria-label="Grid view"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-pressed="false"
                  aria-label="List view"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {docs.length === 0 ? (
          <div className="np-portfolio-empty">
            <h1>The shelf is empty.</h1>
            <p>
              Add projects from the admin to fill the grid.
            </p>
          </div>
        ) : (
          <ul className="np-portfolio-grid">
            {docs.map((project, index) => {
              const span = spanForIndex(project, index);
              const yearLabel = projectYear(project);
              const disc = disciplineParts(project);
              const cover = typeof project.cover === "object" && project.cover
                ? project.cover.url
                : typeof project.cover === "string"
                  ? project.cover
                  : null;
              const badge = (project as { badge?: unknown }).badge;
              return (
                <li
                  key={project.id ?? project.slug ?? `card-${index.toString()}`}
                  className={`np-portfolio-span-${span.toString()}`}
                >
                  <a
                    href={projectHref(project)}
                    className="np-portfolio-card"
                  >
                    <div
                      className={`np-portfolio-card-cover ${coverClass(project, index)}`}
                    >
                      {typeof badge === "string" && badge.length > 0 ? (
                        <span
                          className={
                            badge.toLowerCase() === "featured"
                              ? "np-portfolio-card-badge accent"
                              : "np-portfolio-card-badge"
                          }
                        >
                          {badge}
                        </span>
                      ) : null}
                      <div className="np-portfolio-card-cover-inner">
                        {cover ? (
                          <img
                            src={cover}
                            alt={project.title ?? "Project cover"}
                            loading="lazy"
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <span className="np-portfolio-card-fig">
                            {coverFigure(project)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="np-portfolio-card-meta">
                      <h3 className="np-portfolio-card-title">
                        {renderHeadlineWithEm(project.title ?? "Untitled")}
                      </h3>
                      {yearLabel ? (
                        <span className="np-portfolio-card-year">
                          {yearLabel}
                        </span>
                      ) : null}
                    </div>
                    {disc.length > 0 ? (
                      <p className="np-portfolio-card-discipline">
                        {disc.flatMap((part, i) =>
                          i === 0
                            ? [<React.Fragment key={`d-${i.toString()}`}>{part}</React.Fragment>]
                            : [
                                <span
                                  key={`s-${i.toString()}`}
                                  aria-hidden="true"
                                >
                                  ·
                                </span>,
                                <React.Fragment key={`d-${i.toString()}`}>
                                  {part}
                                </React.Fragment>,
                              ],
                        )}
                      </p>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Studio strip */}
      {data.hideStudio || (studioBody.length === 0 && studioStats.length === 0) ? null : (
        <section className="np-portfolio-studio">
          <div className="np-portfolio-container">
            <div className="np-portfolio-studio-grid">
              <div>
                <p className="np-portfolio-studio-eyebrow">{studioEyebrow}</p>
                {studioHeading ? (
                  <h2>{renderHeadlineWithEm(studioHeading)}</h2>
                ) : null}
                {studioBody.map((para, i) => (
                  <p key={`studio-p-${i.toString()}`}>{para}</p>
                ))}
              </div>
              {studioStats.length > 0 ? (
                <ul className="np-portfolio-studio-stats">
                  {studioStats.map((stat, i) => (
                    <li
                      key={`studio-stat-${i.toString()}`}
                      className="np-portfolio-studio-stat"
                    >
                      <p className="np-portfolio-studio-stat-value">
                        {stat.value}
                      </p>
                      <p className="np-portfolio-studio-stat-label">
                        {stat.label}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {/* Contact strip */}
      {!data.hideContact && contactHref ? (
        <section className="np-portfolio-contact">
          <div className="np-portfolio-container">
            <p className="np-portfolio-contact-eyebrow">
              {settings.bookingNotice}
            </p>
            <a
              href={contactHref}
              className="np-portfolio-contact-mail"
            >
              {settings.contactEmail}
            </a>
          </div>
        </section>
      ) : null}
    </>
  );
}

function latestYear(docs: PortfolioProjectDoc[]): number | null {
  let max = -Infinity;
  for (const d of docs) {
    const y = projectYear(d);
    if (y) {
      const n = Number(y);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return Number.isFinite(max) ? max : null;
}

function oldestYear(docs: PortfolioProjectDoc[]): number | null {
  let min = Infinity;
  for (const d of docs) {
    const y = projectYear(d);
    if (y) {
      const n = Number(y);
      if (!Number.isNaN(n) && n < min) min = n;
    }
  }
  return Number.isFinite(min) ? min : null;
}

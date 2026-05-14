import type { NpTemplateRenderProps } from "@nexpress/theme";

import type { MagazinePostCardDoc } from "../components/post-card.js";
import { toRoman } from "../lib/roman.js";
import { resolveMagazineSettings } from "../settings-helpers.js";

/**
 * Magazine index — front-page editorial layout.
 *
 *   1. **Lead (cover story)** — large 2-col split: gradient
 *      cover on the left with a Roman-numeral figure overlay,
 *      body block on the right (kicker rule, italic display
 *      title, italic deck, byline rule with read time).
 *   2. **"In this issue" 3-up** — three secondary stories in a
 *      single row, each with a small story-cover figure, kicker,
 *      title, italic excerpt, and byline.
 *   3. **Dispatches + archive split** — left column lists time-
 *      stamped short dispatches; right column is a 2-col archive
 *      grid with small square thumbnails.
 *   4. **Subscribe band** — deep-ink full-bleed strip below the
 *      grid with a plain-form newsletter input. Lives inside this
 *      template (not the global footer slot) so pages that aren't
 *      post-list can choose to include or omit the band.
 *
 * Doc shape: `{ docs, heading?, intro? }` where `docs` is a
 * MagazinePostCardDoc[]. Layout zones are filled by **position
 * in the array** — first doc becomes the lead, next three the
 * 3-up, next four the dispatch list, the rest the archive grid.
 * A `featured: true` flag on a doc promotes it to the lead
 * regardless of position so editors can override without
 * reordering. Operators that need a different split (filter by
 * category, etc.) fork this template — the layout zones are
 * deliberately shallow.
 */

interface PostListDoc {
  docs?: MagazinePostCardDoc[];
  heading?: string;
  intro?: string;
  /** Hide the subscribe band when the operator wires their own. */
  hideSubscribe?: boolean;
}

const COVER_VARIANTS: Array<2 | 3 | 4 | 5 | 6 | 7> = [2, 3, 4, 5, 6, 7];

function coverClass(index: number): string {
  return `np-magazine-cover-${COVER_VARIANTS[index % COVER_VARIANTS.length]!.toString()}`;
}

function bylineLabel(doc: MagazinePostCardDoc): string {
  if (doc.author && typeof doc.author === "object" && doc.author.name) {
    return doc.author.name;
  }
  if (typeof doc.author === "string") return doc.author;
  return "Editorial";
}

function readingLabel(doc: MagazinePostCardDoc): string | null {
  if (!doc.readingTime && doc.readingTime !== 0) return null;
  if (typeof doc.readingTime === "number") {
    return `${doc.readingTime.toString()} min`;
  }
  return doc.readingTime;
}

function postHref(doc: MagazinePostCardDoc): string {
  if (doc.slug) {
    return doc.slug.startsWith("/") ? doc.slug : `/blog/${doc.slug}`;
  }
  return "#";
}

/**
 * ISO-style week-of-year for the cover-story issue number. Used
 * as the fallback when the operator hasn't pinned an explicit
 * `leadIssueNumber` in theme settings. We deliberately keep this
 * naive (year-relative, not strict ISO) so a fresh install in
 * week 3 ships with issue "3" and rotates weekly without an
 * operator touching admin.
 */
function weekOfYear(now: Date): number {
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const msSinceYearStart = now.getTime() - yearStart.getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return Math.floor(msSinceYearStart / weekMs) + 1;
}

function dispatchTime(doc: MagazinePostCardDoc): string {
  if (!doc.publishedAt) return "";
  try {
    const d =
      typeof doc.publishedAt === "string"
        ? new Date(doc.publishedAt)
        : doc.publishedAt;
    if (Number.isNaN(d.getTime())) return "";
    const month = d.toLocaleString(undefined, { month: "short" });
    const day = d.getDate();
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `${month} ${day.toString()} · ${hh}:${mm}`;
  } catch {
    return "";
  }
}

function archiveSection(doc: MagazinePostCardDoc): string {
  if (Array.isArray(doc.categories) && doc.categories.length > 0) {
    const first = doc.categories[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "name" in first) {
      const name = (first as { name?: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  return "Story";
}

function archiveDateLabel(doc: MagazinePostCardDoc): string {
  if (!doc.publishedAt) return "";
  try {
    const d =
      typeof doc.publishedAt === "string"
        ? new Date(doc.publishedAt)
        : doc.publishedAt;
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

function leadDoc(docs: MagazinePostCardDoc[]): {
  lead: MagazinePostCardDoc | null;
  rest: MagazinePostCardDoc[];
} {
  // Operator can promote any doc to the lead via `featured: true`.
  // First-featured wins; otherwise the first doc.
  const featuredIdx = docs.findIndex(
    (d) => "featured" in d && Boolean((d as { featured?: unknown }).featured),
  );
  if (featuredIdx >= 0) {
    const lead = docs[featuredIdx]!;
    const rest = [...docs.slice(0, featuredIdx), ...docs.slice(featuredIdx + 1)];
    return { lead, rest };
  }
  if (docs.length === 0) return { lead: null, rest: [] };
  return { lead: docs[0]!, rest: docs.slice(1) };
}

export async function PostListTemplate({ doc }: NpTemplateRenderProps) {
  const data = doc as PostListDoc;
  const settings = await resolveMagazineSettings();
  const all = data.docs ?? [];
  if (all.length === 0) {
    return (
      <section className="np-magazine-index">
        <div className="np-magazine-container">
          <p
            style={{
              padding: "4rem 0",
              textAlign: "center",
              color: "var(--np-color-muted-foreground)",
              fontStyle: "italic",
            }}
          >
            The next issue is on press.
          </p>
        </div>
      </section>
    );
  }

  const { lead, rest } = leadDoc(all);
  const secondary = rest.slice(0, 3);
  const dispatches = rest.slice(3, 7);
  const archive = rest.slice(7, 13);
  // Operator override takes precedence; otherwise fall back to
  // the ISO-week-of-year so a fresh install ships with a sensible
  // running issue counter rather than a static "47".
  const leadIssueNumber = settings.leadIssueNumber ?? weekOfYear(new Date());

  return (
    <>
      <section className="np-magazine-index">
        <div className="np-magazine-container">
          {/* Cover story lead */}
          {lead ? (
            <article className="np-magazine-lead">
              <a
                href={postHref(lead)}
                className="np-magazine-lead-cover"
                aria-label={lead.title ?? "Cover story"}
              >
                <span className="np-magazine-lead-cover-figure">
                  No.
                  <br />
                  {leadIssueNumber.toString()}
                </span>
                <span className="np-magazine-lead-cover-caption">
                  Photograph by editorial
                </span>
              </a>
              <div className="np-magazine-lead-body">
                <p className="np-magazine-lead-kicker">The cover story</p>
                <h1 className="np-magazine-lead-title">
                  <a
                    href={postHref(lead)}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    {lead.title ?? "Untitled"}
                  </a>
                </h1>
                {lead.excerpt ? (
                  <p className="np-magazine-lead-deck">{lead.excerpt}</p>
                ) : null}
                <div className="np-magazine-byline">
                  <span>
                    By{" "}
                    <span className="np-magazine-byline-author">
                      {bylineLabel(lead)}
                    </span>
                  </span>
                  {readingLabel(lead) ? (
                    <>
                      <span
                        className="np-magazine-byline-sep"
                        aria-hidden="true"
                      >
                        ·
                      </span>
                      <span>{readingLabel(lead)} read</span>
                    </>
                  ) : null}
                  <a
                    href={postHref(lead)}
                    className="np-magazine-byline-link"
                  >
                    Read →
                  </a>
                </div>
              </div>
            </article>
          ) : null}

          {/* "In this issue" 3-up */}
          {secondary.length > 0 ? (
            <>
              <h2 className="np-magazine-rule-head">In this issue</h2>
              <ul className="np-magazine-row">
                {secondary.map((post, index) => (
                  <li
                    key={post.id ?? post.slug ?? `secondary-${index.toString()}`}
                  >
                    <a className="np-magazine-story" href={postHref(post)}>
                      <div
                        className={`np-magazine-story-cover ${coverClass(index)}`}
                      >
                        <div className="np-magazine-story-cover-figure">
                          {toRoman(index + 2)}
                        </div>
                      </div>
                      {Array.isArray(post.categories) && post.categories.length > 0 ? (
                        <p className="np-magazine-story-kicker">
                          {archiveSection(post)}
                        </p>
                      ) : null}
                      <h3 className="np-magazine-story-title">
                        {post.title ?? "Untitled"}
                      </h3>
                      {post.excerpt ? (
                        <p className="np-magazine-story-excerpt">
                          {post.excerpt}
                        </p>
                      ) : null}
                      <p className="np-magazine-story-byline">
                        <strong>{bylineLabel(post)}</strong>
                        {readingLabel(post) ? ` · ${readingLabel(post)}` : ""}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {/* Dispatches + archive split */}
          {dispatches.length > 0 || archive.length > 0 ? (
            <section className="np-magazine-split">
              <div>
                <h2 className="np-magazine-dispatches-head">
                  From the dispatch desk
                </h2>
                <ul className="np-magazine-dispatches">
                  {dispatches.map((post, index) => (
                    <li
                      key={post.id ?? post.slug ?? `dispatch-${index.toString()}`}
                      className="np-magazine-dispatch"
                    >
                      <p className="np-magazine-dispatch-time">
                        {dispatchTime(post)}
                      </p>
                      <a
                        className="np-magazine-dispatch-title"
                        href={postHref(post)}
                      >
                        {post.title ?? "Untitled"}
                      </a>
                      {post.excerpt ? (
                        <p className="np-magazine-dispatch-excerpt">
                          {post.excerpt}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h2 className="np-magazine-archive-head">
                  From the archive
                  <a href="/archive">See all →</a>
                </h2>
                <ul className="np-magazine-archive">
                  {archive.map((post, index) => (
                    <li
                      key={post.id ?? post.slug ?? `archive-${index.toString()}`}
                    >
                      <a
                        className="np-magazine-archive-item"
                        href={postHref(post)}
                      >
                        <div
                          className={`np-magazine-archive-item-cover ${coverClass((index + 2) % COVER_VARIANTS.length)}`}
                        >
                          <div className="np-magazine-archive-item-cover-fig">
                            {toRoman(index + 5)}
                          </div>
                        </div>
                        <div>
                          <p className="np-magazine-archive-item-section">
                            {archiveSection(post)} · {archiveDateLabel(post)}
                          </p>
                          <h3 className="np-magazine-archive-item-title">
                            {post.title ?? "Untitled"}
                          </h3>
                          <p className="np-magazine-archive-item-byline">
                            {bylineLabel(post)}
                          </p>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      </section>

      {/* Subscribe band — full-bleed deep-ink strip. */}
      {data.hideSubscribe ? null : (
        <section className="np-magazine-subscribe" aria-label="Subscribe">
          <div className="np-magazine-subscribe-inner">
            <p className="np-magazine-subscribe-eyebrow">Subscribe</p>
            <h2>Every other Sunday, by inbox.</h2>
            <p>
              The full issue, the dispatch desk, the unpublished outtakes —
              free to read, free to forward, cancel any time.
            </p>
            <form
              className="np-magazine-subscribe-form"
              action="/api/newsletter"
              method="POST"
            >
              <label className="sr-only" htmlFor="np-magazine-subscribe-email">
                Email address
              </label>
              <input
                id="np-magazine-subscribe-email"
                type="email"
                name="email"
                placeholder="your.address@elsewhere.com"
                autoComplete="email"
                required
              />
              <button type="submit">Subscribe</button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}

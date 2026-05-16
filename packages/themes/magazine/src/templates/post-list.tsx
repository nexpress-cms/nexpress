import type { NpTemplateRenderProps } from "@nexpress/theme";

import {
  MagazineArchiveItem,
  type MagazineArchiveItemDoc,
} from "../components/archive-item.js";
import { MagazineNewsletterForm } from "../newsletter-form-bridge.js";
import type { MagazinePostCardDoc } from "../components/post-card.js";
import { toRoman } from "../lib/roman.js";
import { resolveMagazineSettings } from "../settings-helpers.js";

/**
 * Magazine index — front-page editorial layout.
 *
 *   1. **Lead (cover story)** — 2-col split: cover image on the
 *      left (gradient + Roman-numeral fallback when no image),
 *      body block on the right.
 *   2. **"In this issue" 3-up** — three secondary stories.
 *   3. **Dispatches + archive split** — dispatch column +
 *      2-col `MagazineArchiveItem` grid.
 *   4. **Subscribe band** — full-bleed deep-ink strip with
 *      `MagazineNewsletterForm`.
 *
 * Doc shape: `{ docs, heading?, intro? }`. Layout zones fill by
 * **position in the array** — first doc is the lead, next three
 * the 3-up, next four the dispatch list, the rest the archive
 * grid. `featured: true` on any doc promotes it to the lead.
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

function kickerLabel(doc: MagazinePostCardDoc): string | null {
  if (Array.isArray(doc.categories) && doc.categories.length > 0) {
    const first = doc.categories[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "name" in first) {
      const name = (first as { name?: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  if (Array.isArray(doc.tags) && doc.tags.length > 0) {
    const first = doc.tags[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "name" in first) {
      const name = (first as { name?: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  return null;
}

function coverImageOf(
  doc: MagazinePostCardDoc,
): { url: string; alt: string } | null {
  const raw = doc.coverImage ?? doc.cover;
  if (!raw) return null;
  if (typeof raw === "string") return { url: raw, alt: doc.title ?? "" };
  if (typeof raw.url !== "string" || raw.url.length === 0) return null;
  return { url: raw.url, alt: raw.alt ?? doc.title ?? "" };
}

function leadDoc(docs: MagazinePostCardDoc[]): {
  lead: MagazinePostCardDoc | null;
  rest: MagazinePostCardDoc[];
} {
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
          <p className="np-magazine-archive-empty">
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
  const leadIssueNumber = settings.leadIssueNumber ?? weekOfYear(new Date());
  const leadCover = lead ? coverImageOf(lead) : null;

  return (
    <>
      <section className="np-magazine-index">
        <div className="np-magazine-container">
          {lead ? (
            <article className="np-magazine-lead">
              <a
                href={postHref(lead)}
                className="np-magazine-lead-cover"
                aria-label={lead.title ?? "Cover story"}
                data-has-image={leadCover ? "true" : undefined}
              >
                {leadCover ? (
                  <img
                    className="np-magazine-cover-image"
                    src={leadCover.url}
                    alt={leadCover.alt}
                    loading="lazy"
                  />
                ) : (
                  <span className="np-magazine-lead-cover-figure">
                    No.
                    <br />
                    {leadIssueNumber.toString()}
                  </span>
                )}
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

          {secondary.length > 0 ? (
            <>
              <h2 className="np-magazine-rule-head">In this issue</h2>
              <ul className="np-magazine-row">
                {secondary.map((post, index) => {
                  const kicker = kickerLabel(post);
                  const cover = coverImageOf(post);
                  return (
                    <li
                      key={post.id ?? post.slug ?? `secondary-${index.toString()}`}
                    >
                      <a className="np-magazine-story" href={postHref(post)}>
                        <div
                          className={`np-magazine-story-cover ${coverClass(index)}`}
                          data-has-image={cover ? "true" : undefined}
                        >
                          {cover ? (
                            <img
                              className="np-magazine-cover-image"
                              src={cover.url}
                              alt={cover.alt}
                              loading="lazy"
                            />
                          ) : (
                            <div className="np-magazine-story-cover-figure">
                              {toRoman(index + 2)}
                            </div>
                          )}
                        </div>
                        {kicker ? (
                          <p className="np-magazine-story-kicker">{kicker}</p>
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
                  );
                })}
              </ul>
            </>
          ) : null}

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
                      <MagazineArchiveItem
                        doc={post as MagazineArchiveItemDoc}
                        romanIndex={index + 4}
                        coverVariant={
                          COVER_VARIANTS[(index + 2) % COVER_VARIANTS.length]
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      </section>

      {data.hideSubscribe ? null : (
        <section className="np-magazine-subscribe" aria-label="Subscribe">
          <div className="np-magazine-subscribe-inner">
            <p className="np-magazine-subscribe-eyebrow">Subscribe</p>
            <h2>Every other Sunday, by inbox.</h2>
            <p>
              The full issue, the dispatch desk, the unpublished outtakes —
              free to read, free to forward, cancel any time.
            </p>
            <MagazineNewsletterForm />
            {settings.subscribeStats ? (
              <p className="np-magazine-subscribe-stats">
                {settings.subscribeStats}
              </p>
            ) : null}
          </div>
        </section>
      )}
    </>
  );
}

import type { NpTemplateRenderProps } from "@nexpress/theme";

import {
  MagazinePostCard,
  type MagazinePostCardDoc,
} from "../components/post-card.js";

/**
 * Magazine index. Editorial layout — one big "lead" piece on
 * top, a 2-column secondary row, then the archive grid below.
 * Designed to look like the front page of a magazine rather
 * than a blog roll.
 *
 * Doc shape: `{ docs: MagazinePostCardDoc[], heading?, intro? }`.
 */
interface PostListDoc {
  docs?: MagazinePostCardDoc[];
  heading?: string;
  intro?: string;
}

export function PostListTemplate({ doc }: NpTemplateRenderProps) {
  const data = doc as PostListDoc;
  const heading = data.heading ?? "Latest";
  const intro = data.intro;
  const all = data.docs ?? [];
  if (all.length === 0) {
    return (
      <section className="np-magazine-index np-magazine-index-empty">
        <header>
          <h1>{heading}</h1>
          <p>No stories yet.</p>
        </header>
      </section>
    );
  }
  const [lead, ...rest] = all;
  const secondary = rest.slice(0, 2);
  const archive = rest.slice(2);

  return (
    <section className="np-magazine-index">
      <header className="np-magazine-index-header">
        <h1>{heading}</h1>
        {intro ? <p className="np-magazine-index-intro">{intro}</p> : null}
      </header>
      {lead ? (
        <div className="np-magazine-index-lead">
          <MagazinePostCard doc={lead} variant="feature" />
        </div>
      ) : null}
      {secondary.length > 0 ? (
        <div className="np-magazine-index-row">
          {secondary.map((post) => (
            <MagazinePostCard
              key={post.id ?? post.slug ?? post.title}
              doc={post}
              variant="list"
            />
          ))}
        </div>
      ) : null}
      {archive.length > 0 ? (
        <>
          <h2 className="np-magazine-index-archive-heading">Archive</h2>
          <div className="np-magazine-index-archive">
            {archive.map((post) => (
              <MagazinePostCard
                key={post.id ?? post.slug ?? post.title}
                doc={post}
                variant="grid"
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

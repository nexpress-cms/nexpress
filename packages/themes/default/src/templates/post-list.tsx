import type { NpTemplateRenderProps } from "@nexpress/theme";

import { PostCard, type PostCardDoc } from "../components/post-card.js";

/**
 * Blog index template. Picks one feature post (newest, or a
 * doc explicitly flagged with `featured: true`) and lays the
 * rest as a 3-column grid that collapses to 1 column on phones.
 *
 * The template is collection-agnostic — sites can route any
 * collection through it (e.g. /resources, /case-studies). The
 * doc shape we expect is `{ docs: PostCardDoc[] }`; templates
 * that need pagination metadata can render `<Pagination />`
 * around their own data fetch in the route handler.
 */
interface PostListDoc {
  docs?: PostCardDoc[];
  /** Page heading shown above the grid. Defaults to "Posts". */
  heading?: string;
  /** Optional paragraph beneath the heading. */
  intro?: string;
}

export function PostListTemplate({ doc }: NpTemplateRenderProps) {
  const data = doc as PostListDoc;
  const heading = data.heading ?? "Posts";
  const intro = data.intro;
  const all = data.docs ?? [];
  if (all.length === 0) {
    return (
      <section className="nx-post-list nx-post-list-empty">
        <header>
          <h1>{heading}</h1>
          <p>No posts yet — once you publish from the admin, they'll appear here.</p>
        </header>
      </section>
    );
  }
  const [feature, ...rest] = all;

  return (
    <section className="nx-post-list">
      <header className="nx-post-list-header">
        <h1>{heading}</h1>
        {intro ? <p className="nx-post-list-intro">{intro}</p> : null}
      </header>
      {feature ? (
        <div className="nx-post-list-feature">
          <PostCard doc={feature} variant="feature" />
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="nx-post-list-grid">
          {rest.map((post) => (
            <PostCard key={post.id ?? post.slug ?? post.title} doc={post} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

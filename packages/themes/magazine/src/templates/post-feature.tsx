import { renderRichText } from "@nexpress/editor";
import type { NpRichTextContent } from "@nexpress/editor";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Long-form post template — kicker / large headline / byline
 * rule / dropcap on the first paragraph. Reads from the
 * standard post fields (title, content, author, publishedAt)
 * with optional kicker support if the collection adds one.
 */
export function PostFeatureTemplate({ doc }: NpTemplateRenderProps) {
  const title = (doc as { title?: string }).title ?? "Untitled";
  const kicker = (doc as { kicker?: string }).kicker;
  const author = (doc as { authorName?: string }).authorName;
  const published = (doc as { publishedAt?: string }).publishedAt;
  const content = (doc as { content?: NpRichTextContent }).content;

  return (
    <article className="np-magazine-feature">
      {kicker ? <p className="np-magazine-feature-kicker">{kicker}</p> : null}
      <h1 className="np-magazine-feature-title">{title}</h1>
      {author || published ? (
        <p className="np-magazine-feature-byline">
          {author ? `By ${author}` : null}
          {author && published ? " · " : null}
          {published
            ? new Date(published).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : null}
        </p>
      ) : null}
      <div className="np-magazine-feature-body">
        {content ? renderRichText(content) : null}
      </div>
    </article>
  );
}

import { getMediaUrl } from "@nexpress/core/media";
import { isNpRichTextContent } from "@nexpress/core/fields";
import { renderRichText } from "@nexpress/editor/server";
import type { NpTemplateRenderProps } from "@nexpress/theme";
import Link from "next/link";

interface StorefrontPostDoc {
  title?: string;
  excerpt?: string;
  content?: unknown;
  publishedAt?: Date | string;
  coverImage?: string | null;
}

export async function StorefrontPostDefault({ doc }: NpTemplateRenderProps) {
  const post = doc as StorefrontPostDoc;
  const coverUrl = post.coverImage
    ? await getMediaUrl(post.coverImage, { variant: "large" })
    : null;
  return (
    <main className="np-storefront-container np-storefront-post">
      <Link href="/blog">Journal</Link>
      <header>
        <h1>{post.title ?? "Untitled"}</h1>
        {post.excerpt ? <p>{post.excerpt}</p> : null}
        {post.publishedAt ? (
          <time dateTime={new Date(post.publishedAt).toISOString()}>
            {new Date(post.publishedAt).toLocaleDateString()}
          </time>
        ) : null}
      </header>
      {coverUrl ? <img src={coverUrl} alt="" className="np-storefront-post-cover" /> : null}
      <article className="np-storefront-prose">
        {isNpRichTextContent(post.content) ? renderRichText(post.content) : null}
      </article>
    </main>
  );
}

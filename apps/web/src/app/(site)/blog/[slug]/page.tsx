import { getPostBySlug } from "@nexpress/core";
import { renderRichText } from "@nexpress/editor/server";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import { NxImage, getMediaUrl } from "@/components/nx-image";
import { ensureCoreServices } from "@/lib/init-core";
import type { Metadata } from "next";
import type { NxRichTextContent } from "@nexpress/editor";

interface PostPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PostPage({ params }: PostPageProps) {
  ensureCoreServices();
  const { slug } = await params;
  const { isEnabled: isDraft } = await draftMode();
  const post = await getPostBySlug(slug, { draft: isDraft });
  if (!post) notFound();

  const content = post.content as NxRichTextContent | undefined;

  return (
    <article className="nx-post">
      {isDraft ? (
        <div className="nx-draft-banner" style={{ padding: "0.75rem 1rem", background: "#fef3c7", color: "#92400e", fontSize: "0.875rem", textAlign: "center" }}>
          Draft preview — <a href="/api/preview/exit" style={{ color: "inherit", textDecoration: "underline" }}>exit</a>
        </div>
      ) : null}
      <header className="nx-post-header">
        <h1>{post.title as string}</h1>
        {post.publishedAt ? (
          <time dateTime={(post.publishedAt as Date).toISOString()}>
            {(post.publishedAt as Date).toLocaleDateString()}
          </time>
        ) : null}
      </header>
      {post.coverImage ? (
        <div className="nx-post-cover">
          <NxImage media={post.coverImage as string} size="large" priority />
        </div>
      ) : null}
      {content && (
        <div className="nx-post-content prose">
          {renderRichText(content)}
        </div>
      )}
    </article>
  );
}

export async function generateMetadata({
  params,
}: PostPageProps): Promise<Metadata> {
  ensureCoreServices();
  const { slug } = await params;
  const { isEnabled: isDraft } = await draftMode();
  const post = await getPostBySlug(slug, { draft: isDraft });
  if (!post) return {};

  const title = (post.seo as Record<string, unknown>)?.metaTitle ?? post.title;
  const description =
    (post.seo as Record<string, unknown>)?.metaDescription ?? post.excerpt;
  const ogImageId = (post.seo as Record<string, unknown>)?.ogImage as
    | string
    | undefined;

  return {
    title: title as string,
    description: description as string | undefined,
    openGraph: ogImageId
      ? { images: [{ url: await getMediaUrl(ogImageId, "og") }] }
      : undefined,
  };
}

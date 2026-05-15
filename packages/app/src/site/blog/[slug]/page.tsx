import {
  buildArticleJsonLd,
  getPostBySlug,
  getSiteSeoSettings,
  resolveTemplateComponent,
} from "@nexpress/core";
import { renderRichText } from "@nexpress/editor/server";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import { NpImage, getMediaUrl } from "../../../components/np-image";
import { ShellWrap } from "../../../components/shell-wrap";
import { ensureFor } from "../../../lib/init-core";
import {
  RenderBodyEnd,
  RenderHead,
  collectRenderContributions,
} from "../../../components/render-contributions";
import { Comments } from "@nexpress/next/client";
import { JsonLd, createSiteScopedBlockRenderContext } from "@nexpress/next";
import type { Metadata } from "next";
import type { ComponentType } from "react";
import type { NpRichTextContent } from "@nexpress/editor";

interface PostPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PostPage({ params }: PostPageProps) {
  await ensureFor("plugins");
  const { slug } = await params;
  const { isEnabled: isDraft } = await draftMode();
  const post = await getPostBySlug(slug, { draft: isDraft });
  if (!post) notFound();

  // Universal-content-model #748: `/blog/<slug>` is the article
  // surface. Doc-kind posts have their own canonical URL
  // (`/docs/<slug>`) wired through the docs theme's route +
  // `posts.seo.urlPath`. Visiting `/blog/<slug>` for a doc-kind
  // post would render through the article template chrome,
  // which is wrong — 404 instead. (Operators with a string-
  // matched bookmark land on `/docs/<slug>` after slug-history
  // resolves the kind.)
  const postKind = typeof post.kind === "string" ? post.kind : "article";
  if (postKind !== "article") notFound();

  const content = post.content as NpRichTextContent | undefined;

  const { head, bodyEnd } = await collectRenderContributions({
    collection: "posts",
    slug,
    document: post,
  });

  // BlogPosting JSON-LD — gives search engines the headline,
  // dates, image, and author for rich-result rendering. The
  // ogImage field on the post (when set) doubles as the
  // structured-data image.
  const settings = await getSiteSeoSettings();
  const articleJsonLd = await buildArticleJsonLd({
    url: `${settings.siteUrl.replace(/\/+$/, "")}/blog/${slug}`,
    headline: post.title as string,
    description: typeof post.excerpt === "string" && post.excerpt ? post.excerpt : null,
    image:
      typeof post.coverImage === "string" && post.coverImage
        ? await getMediaUrl(post.coverImage, "og")
        : null,
    datePublished:
      post.publishedAt instanceof Date
        ? post.publishedAt
        : ((post.createdAt as Date | undefined) ?? null),
    dateModified: (post.updatedAt as Date | undefined) ?? null,
    type: "BlogPosting",
  });

  // Phase #612 (2026-05-11) — dispatch through the active
  // theme's `templates.posts.{detail,default}` if either is
  // declared. The doc's own `template` field wins if set,
  // matching the `pages` catch-all's behavior. Otherwise the
  // framework's inline body renders below.
  const DetailTemplate = await resolvePostDetailTemplate(
    typeof post.template === "string" ? post.template : null,
    typeof post.kind === "string" ? post.kind : null,
  );

  if (DetailTemplate) {
    const blockCtx = await createSiteScopedBlockRenderContext();
    return (
      <ShellWrap surface="site">
        <JsonLd data={articleJsonLd as unknown as Record<string, unknown>} />
        <RenderHead entries={head} />
        {isDraft ? (
          <div
            className="np-draft-banner"
            style={{
              padding: "0.75rem 1rem",
              background: "#fef3c7",
              color: "#92400e",
              fontSize: "0.875rem",
              textAlign: "center",
            }}
          >
            Draft preview —{" "}
            <a href="/api/preview/exit" style={{ color: "inherit", textDecoration: "underline" }}>
              exit
            </a>
          </div>
        ) : null}
        <DetailTemplate doc={post} blockCtx={blockCtx} />
        <Comments collectionSlug="posts" documentId={String(post.id)} />
        <RenderBodyEnd entries={bodyEnd} />
      </ShellWrap>
    );
  }

  return (
    <ShellWrap surface="site">
      <article className="np-post">
        <JsonLd data={articleJsonLd as unknown as Record<string, unknown>} />
        <RenderHead entries={head} />
        {isDraft ? (
          <div
            className="np-draft-banner"
            style={{
              padding: "0.75rem 1rem",
              background: "#fef3c7",
              color: "#92400e",
              fontSize: "0.875rem",
              textAlign: "center",
            }}
          >
            Draft preview —{" "}
            <a href="/api/preview/exit" style={{ color: "inherit", textDecoration: "underline" }}>
              exit
            </a>
          </div>
        ) : null}
        <header className="np-post-header">
          <h1>{post.title as string}</h1>
          {post.publishedAt ? (
            <time dateTime={(post.publishedAt as Date).toISOString()}>
              {(post.publishedAt as Date).toLocaleDateString()}
            </time>
          ) : null}
        </header>
        {post.coverImage ? (
          <div className="np-post-cover">
            <NpImage media={post.coverImage as string} size="large" priority />
          </div>
        ) : null}
        {content && <div className="np-post-content prose">{renderRichText(content)}</div>}
        <Comments collectionSlug="posts" documentId={String(post.id)} />
        <RenderBodyEnd entries={bodyEnd} />
      </article>
    </ShellWrap>
  );
}

type PostDetailTemplate = ComponentType<{
  doc: Record<string, unknown>;
  blockCtx?: unknown;
}>;

/**
 * Walk the conventional post-detail template IDs in priority
 * order: the doc's own `template` field wins if set (matching
 * the pages catch-all), then the post's `kind` value
 * (universal-content-model #748 — `templates.posts.doc` for
 * doc-kind posts, etc.), then the legacy `detail` / `default` /
 * `feature` triple. Both magazine (`templates.posts.feature`)
 * and portfolio (`templates.posts.detail`) honor this priority
 * by naming their entries accordingly.
 *
 * Note: the `/blog/<slug>` route 404s when `post.kind !==
 * "article"` (see earlier guard) so the kind candidate is only
 * exercised for article-kind posts that happen to register
 * `templates.posts.article` — a theme that wants per-kind
 * templates without going through their own theme route.
 */
async function resolvePostDetailTemplate(
  explicitTemplateId: string | null,
  kind: string | null,
): Promise<PostDetailTemplate | null> {
  const candidates: string[] = [];
  if (explicitTemplateId) candidates.push(explicitTemplateId);
  if (kind && kind.length > 0) candidates.push(kind);
  candidates.push("detail", "default", "feature");
  for (const templateId of candidates) {
    const entry = (await resolveTemplateComponent("posts", templateId)) as
      | { component?: PostDetailTemplate }
      | null;
    if (entry?.component) return entry.component;
  }
  return null;
}

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  await ensureFor("read");
  const { slug } = await params;
  const { isEnabled: isDraft } = await draftMode();
  const post = await getPostBySlug(slug, { draft: isDraft });
  if (!post) return {};

  const title = (post.seo as Record<string, unknown>)?.metaTitle ?? post.title;
  const description = (post.seo as Record<string, unknown>)?.metaDescription ?? post.excerpt;
  const ogImageId = (post.seo as Record<string, unknown>)?.ogImage as string | undefined;

  return {
    title: title as string,
    description: description as string | undefined,
    openGraph: ogImageId ? { images: [{ url: await getMediaUrl(ogImageId, "og") }] } : undefined,
  };
}

import {
  buildDiscussionForumPostingJsonLd,
  findDocuments,
  getDb,
  getSiteSeoSettings,
  npMembers,
} from "@nexpress/core";
import { renderRichText } from "@nexpress/editor/server";
import type { NpRichTextContent } from "@nexpress/editor";
import { Comments } from "@nexpress/next/client";
import {
  buildPageMetadata,
  JsonLd,
  getSiteMember,
} from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DiscussionAuthorActions } from "../client/discussion-author-actions.js";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending review",
  draft: "Draft",
  archived: "Archived",
};

export async function detailMetadata(ctx: NpRouteRenderProps): Promise<Metadata> {
  const slug = typeof ctx.params.slug === "string" ? ctx.params.slug : "";
  if (!slug) {
    return buildPageMetadata({
      title: "Discussion",
      description: null,
      path: "/discussions",
    });
  }
  const result = await findDocuments("discussions", {
    where: { slug, status: "published" },
    limit: 1,
  });
  const doc = result.docs[0];

  // A non-published or missing row falls back to a generic
  // "Discussion not found" title — `notFound()` in the page
  // body will turn the response into a 404 anyway, but search
  // crawlers fetching just the head still need a sane title.
  return buildPageMetadata({
    title: typeof doc?.title === "string" ? doc.title : "Discussion",
    description:
      typeof doc?.excerpt === "string" && doc.excerpt ? doc.excerpt : null,
    path: `/discussions/${slug}`,
    ogType: "article",
    publishedTime: doc?.createdAt instanceof Date ? doc.createdAt : null,
    modifiedTime: doc?.updatedAt instanceof Date ? doc.updatedAt : null,
  });
}

export default async function DiscussionDetailRoute({
  params,
}: NpRouteRenderProps) {
  const slug = typeof params.slug === "string" ? params.slug : "";
  if (!slug) notFound();

  const member = await getSiteMember();
  const result = await findDocuments("discussions", {
    where: { slug },
    limit: 1,
  });
  const doc = result.docs[0];
  if (!doc) notFound();

  const status = doc.status as string;
  const memberAuthorId = (doc.memberAuthorId as string | null) ?? null;
  const isOwner = member !== null && memberAuthorId === member.id;

  // Visibility rule: only the author (and staff, who'd use admin)
  // can see non-published rows. Render 404 to anyone else so a
  // pending discussion's URL doesn't leak the title to the public.
  if (status !== "published" && !isOwner) {
    notFound();
  }

  let author: { id: string; handle: string; displayName: string } | null = null;
  if (memberAuthorId) {
    const db = getDb();
    if (db) {
      const [row] = (await db
        .select({
          id: npMembers.id,
          handle: npMembers.handle,
          displayName: npMembers.displayName,
        })
        .from(npMembers)
        .where(eq(npMembers.id, memberAuthorId))
        .limit(1)) as Array<{ id: string; handle: string; displayName: string }>;
      if (row) author = row;
    }
  }

  const body = (doc.body as NpRichTextContent | undefined) ?? null;

  // DiscussionForumPosting JSON-LD — only for published rows so
  // pending / draft submissions don't surface in search before
  // a mod approves them. Authors of pending submissions still
  // see the page (rendered without the structured-data block).
  const settings = await getSiteSeoSettings();
  const jsonLd =
    status === "published"
      ? await buildDiscussionForumPostingJsonLd({
          url: `${settings.siteUrl.replace(/\/+$/, "")}/discussions/${slug}`,
          headline: doc.title as string,
          description:
            typeof doc.excerpt === "string" && doc.excerpt ? doc.excerpt : null,
          datePublished: (doc.createdAt as Date | undefined) ?? null,
          dateModified: (doc.updatedAt as Date | undefined) ?? null,
          authorName: author?.displayName ?? null,
        })
      : null;

  return (
    <article className="np-discussion">
      {jsonLd ? (
        <JsonLd data={jsonLd as unknown as Record<string, unknown>} />
      ) : null}
      <header className="np-discussion-header">
        <Link href="/discussions" className="np-tab">
          ← Back to discussions
        </Link>
        <h1>{doc.title as string}</h1>
        <div className="np-discussion-meta">
          {author ? (
            <Link
              href={`/u/${author.handle}`}
              className="np-discussion-author"
            >
              @{author.handle}
            </Link>
          ) : (
            <span className="np-discussion-author">staff</span>
          )}
          <span aria-hidden="true">·</span>
          <time dateTime={(doc.createdAt as Date).toISOString()}>
            {(doc.createdAt as Date).toLocaleDateString()}
          </time>
          {status !== "published" ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="np-discussions-status-badge">
                {STATUS_LABELS[status] ?? status}
              </span>
            </>
          ) : null}
        </div>
        {isOwner ? (
          <DiscussionAuthorActions docId={doc.id as string} slug={slug} />
        ) : null}
      </header>

      {body ? (
        <div className="np-discussion-body prose">{renderRichText(body)}</div>
      ) : (
        <p className="np-discussion-body-empty">(no body)</p>
      )}

      {/* Comments work against any collection that has
          `community.comments: true` — discussions opted in via the
          forum plugin. Pending discussions skip comments because
          they aren't public yet (the comment form would 404). */}
      {status === "published" ? (
        <section className="np-discussion-comments">
          <h2>Comments</h2>
          <Comments
            collectionSlug="discussions"
            documentId={doc.id as string}
          />
        </section>
      ) : null}
    </article>
  );
}

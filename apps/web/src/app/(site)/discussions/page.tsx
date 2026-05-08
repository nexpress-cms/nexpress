import { getMemberProfiles } from "@nexpress/core";
import { buildPageMetadata } from "@nexpress/next";
import type { Metadata } from "next";
import Link from "next/link";

import type { NpFindWhere } from "@nexpress/core";

import { PaginationNav } from "@/components/pagination-nav";
import { findDiscussions, type DiscussionsDocument } from "@/db/generated/documents";
import { ensureFor } from "@/lib/init-core";
import { getSiteMember } from "@/lib/site-member";

interface DiscussionsListPageProps {
  searchParams: Promise<{ page?: string; author?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  await ensureFor("read");
  return buildPageMetadata({
    title: "Discussions",
    description: "Member-authored discussion threads.",
    path: "/discussions",
  });
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending review",
  draft: "Draft",
  archived: "Archived",
};

export default async function DiscussionsListPage({ searchParams }: DiscussionsListPageProps) {
  await ensureFor("read");
  const params = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const limit = 20;

  const member = await getSiteMember();
  const showMine = params.author === "me" && member !== null;

  // Anonymous + non-author members see only published rows. A logged-in
  // member viewing `?author=me` sees ALL their own docs (including
  // pending) — they need to track what they submitted before a mod
  // reviews it.
  const where: NpFindWhere<DiscussionsDocument> = {};
  if (showMine && member) {
    where.memberAuthorId = member.id;
  } else {
    where.status = "published";
  }

  const result = await findDiscussions({
    where,
    sort: "-createdAt",
    page: pageNum,
    limit,
  });

  // Resolve member-author profiles in one query so each row can render
  // "by @handle" without N round-trips. Anonymous-authored rows (the
  // staff-side path) leave `memberAuthorId` null and skip the lookup.
  const authorIds = result.docs
    .map((d) => d.memberAuthorId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const authorById = await getMemberProfiles(authorIds);

  return (
    <div className="np-discussions">
      <header className="np-discussions-header">
        <h1>Discussions</h1>
        <div className="np-discussions-toolbar">
          {member ? (
            <>
              <Link
                href="/discussions"
                className={!showMine ? "np-tab-active" : "np-tab"}
              >
                All
              </Link>
              <Link
                href="/discussions?author=me"
                className={showMine ? "np-tab-active" : "np-tab"}
              >
                My threads
              </Link>
              <Link href="/discussions/new" className="np-button-primary">
                New discussion
              </Link>
            </>
          ) : (
            <Link
              href="/members/login?next=/discussions/new"
              className="np-button-primary"
            >
              Sign in to post
            </Link>
          )}
        </div>
      </header>

      {result.docs.length === 0 ? (
        <p className="np-discussions-empty">
          {showMine
            ? "You haven't posted any discussions yet."
            : "No discussions yet. Be the first to start one!"}
        </p>
      ) : (
        <ul className="np-discussions-list">
          {result.docs.map((doc) => {
            const author = doc.memberAuthorId ? authorById.get(doc.memberAuthorId) : null;
            return (
              <li key={doc.id} className="np-discussions-card">
                <h2>
                  <Link href={`/discussions/${doc.slug}`}>{doc.title}</Link>
                </h2>
                <div className="np-discussions-meta">
                  {author ? (
                    <Link href={`/u/${author.handle}`} className="np-discussions-author">
                      {author.avatarUrl ? (
                        <img
                          src={author.avatarUrl}
                          alt=""
                          width={20}
                          height={20}
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            objectFit: "cover",
                            verticalAlign: "middle",
                            marginRight: "0.375rem",
                          }}
                        />
                      ) : null}
                      @{author.handle}
                    </Link>
                  ) : (
                    <span className="np-discussions-author">staff</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <time dateTime={doc.createdAt.toISOString()}>
                    {doc.createdAt.toLocaleDateString()}
                  </time>
                  {doc.status !== "published" ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="np-discussions-status-badge">
                        {STATUS_LABELS[doc.status] ?? doc.status}
                      </span>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <PaginationNav
        page={pageNum}
        totalPages={result.totalPages}
        hasPrevPage={result.hasPrevPage}
        hasNextPage={result.hasNextPage}
        className="np-discussions-pagination"
        hrefForPage={(p) =>
          `/discussions?${new URLSearchParams({
            ...(showMine ? { author: "me" } : {}),
            page: String(p),
          }).toString()}`
        }
      />
    </div>
  );
}

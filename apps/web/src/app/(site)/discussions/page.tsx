import { findDocuments, nxMembers } from "@nexpress/core";
import Link from "next/link";

import { ensureCoreServices } from "@/lib/init-core";
import { getDb } from "@/lib/db";
import { getSiteMember } from "@/lib/site-member";
import { inArray } from "drizzle-orm";

interface DiscussionsListPageProps {
  searchParams: Promise<{ page?: string; author?: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending review",
  draft: "Draft",
  archived: "Archived",
};

export default async function DiscussionsListPage({ searchParams }: DiscussionsListPageProps) {
  ensureCoreServices();
  const params = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const limit = 20;

  const member = await getSiteMember();
  const showMine = params.author === "me" && member !== null;

  // Anonymous + non-author members see only published rows. A logged-in
  // member viewing `?author=me` sees ALL their own docs (including
  // pending) — they need to track what they submitted before a mod
  // reviews it.
  const where: Record<string, unknown> = {};
  if (showMine && member) {
    where.memberAuthorId = member.id;
  } else {
    where.status = "published";
  }

  const result = await findDocuments("discussions", {
    where,
    sort: "-createdAt",
    page: pageNum,
    limit,
  });

  // Resolve member-author handles in one query so each row can render
  // "by @handle" without N round-trips. Anonymous-authored rows (the
  // staff-side path) leave `memberAuthorId` null and skip the lookup.
  const authorIds = Array.from(
    new Set(
      result.docs
        .map((d) => (d.memberAuthorId as string | null) ?? null)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const authors = authorIds.length
    ? ((await getDb()
        .select({
          id: nxMembers.id,
          handle: nxMembers.handle,
          displayName: nxMembers.displayName,
        })
        .from(nxMembers)
        .where(inArray(nxMembers.id, authorIds))) as Array<{
        id: string;
        handle: string;
        displayName: string;
      }>)
    : [];
  const authorById = new Map(authors.map((a) => [a.id, a]));

  return (
    <div className="nx-discussions">
      <header className="nx-discussions-header">
        <h1>Discussions</h1>
        <div className="nx-discussions-toolbar">
          {member ? (
            <>
              <Link
                href="/discussions"
                className={!showMine ? "nx-tab-active" : "nx-tab"}
              >
                All
              </Link>
              <Link
                href="/discussions?author=me"
                className={showMine ? "nx-tab-active" : "nx-tab"}
              >
                My threads
              </Link>
              <Link href="/discussions/new" className="nx-button-primary">
                New discussion
              </Link>
            </>
          ) : (
            <Link href="/members/login?next=/discussions/new" className="nx-button-primary">
              Sign in to post
            </Link>
          )}
        </div>
      </header>

      {result.docs.length === 0 ? (
        <p className="nx-discussions-empty">
          {showMine
            ? "You haven't posted any discussions yet."
            : "No discussions yet. Be the first to start one!"}
        </p>
      ) : (
        <ul className="nx-discussions-list">
          {result.docs.map((doc) => {
            const authorId = (doc.memberAuthorId as string | null) ?? null;
            const author = authorId ? authorById.get(authorId) : null;
            const slug = doc.slug as string;
            const status = doc.status as string;
            return (
              <li key={doc.id as string} className="nx-discussions-card">
                <h2>
                  <Link href={`/discussions/${slug}`}>{doc.title as string}</Link>
                </h2>
                <div className="nx-discussions-meta">
                  {author ? (
                    <Link href={`/u/${author.handle}`} className="nx-discussions-author">
                      @{author.handle}
                    </Link>
                  ) : (
                    <span className="nx-discussions-author">staff</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <time dateTime={(doc.createdAt as Date).toISOString()}>
                    {(doc.createdAt as Date).toLocaleDateString()}
                  </time>
                  {status !== "published" ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="nx-discussions-status-badge">
                        {STATUS_LABELS[status] ?? status}
                      </span>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {result.totalPages > 1 ? (
        <nav className="nx-discussions-pagination" aria-label="Pagination">
          {result.hasPrevPage ? (
            <Link
              href={`/discussions?${new URLSearchParams({
                ...(showMine ? { author: "me" } : {}),
                page: String(pageNum - 1),
              }).toString()}`}
            >
              ← Previous
            </Link>
          ) : null}
          <span>
            Page {pageNum} of {result.totalPages}
          </span>
          {result.hasNextPage ? (
            <Link
              href={`/discussions?${new URLSearchParams({
                ...(showMine ? { author: "me" } : {}),
                page: String(pageNum + 1),
              }).toString()}`}
            >
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

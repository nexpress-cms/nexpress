import { findDocuments, getMemberProfiles } from "@nexpress/core";
import type { NpFindWhere } from "@nexpress/core";
import { buildPageMetadata, getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import type { Metadata } from "next";
import Link from "next/link";

import { PaginationNav } from "../components/pagination-nav.js";

/**
 * Locally-defined shape of a `discussions` collection row. The
 * host's typed `findDiscussions` is generated from the host's
 * collections list and lives in `apps/web/src/db/generated/`,
 * which a plugin can't import. We assert the shape against the
 * untyped `findDocuments<T>("discussions", ...)` call instead —
 * the plugin owns the schema (`defineDiscussionsCollection`),
 * so re-stating it here is the source of truth, not a copy.
 */
export interface DiscussionsDocument {
  id: string;
  status: "draft" | "published" | "archived" | "pending";
  createdAt: Date;
  updatedAt: Date;
  memberAuthorId: string | null;
  slug: string;
  title: string;
  body: unknown;
  category?: string | null;
  pinned?: boolean | null;
  locked?: boolean | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending review",
  draft: "Draft",
  archived: "Archived",
};

export async function listMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Discussions",
    description: "Member-authored discussion threads.",
    path: "/discussions",
  });
}

export default async function DiscussionsListRoute({ searchParams }: NpRouteRenderProps) {
  const sp = searchParams ?? {};
  const rawPage =
    typeof sp.page === "string" ? sp.page : Array.isArray(sp.page) ? sp.page[0] : undefined;
  const author =
    typeof sp.author === "string" ? sp.author : Array.isArray(sp.author) ? sp.author[0] : undefined;
  const pageNum = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const limit = 20;

  const member = await getSiteMember();
  const showMine = author === "me" && member !== null;

  // Anonymous + non-author members see only published rows. A
  // logged-in member viewing `?author=me` sees ALL their own
  // docs (including pending) — they need to track what they
  // submitted before a mod reviews it.
  const where: NpFindWhere<DiscussionsDocument> = {};
  if (showMine && member) {
    where.memberAuthorId = member.id;
  } else {
    where.status = "published";
  }

  const result = await findDocuments<DiscussionsDocument>("discussions", {
    where,
    sort: "-createdAt",
    page: pageNum,
    limit,
  });

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
              <Link href="/discussions" className={!showMine ? "np-tab-active" : "np-tab"}>
                All
              </Link>
              <Link href="/discussions?author=me" className={showMine ? "np-tab-active" : "np-tab"}>
                My threads
              </Link>
              <Link href="/discussions/new" className="np-button-primary">
                New discussion
              </Link>
            </>
          ) : (
            <Link href="/members/login?next=/discussions/new" className="np-button-primary">
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
            const profile = doc.memberAuthorId ? authorById.get(doc.memberAuthorId) : null;
            return (
              <li key={doc.id} className="np-discussions-card">
                <h2>
                  <Link href={`/discussions/${doc.slug}`}>{doc.title}</Link>
                </h2>
                <div className="np-discussions-meta">
                  {profile ? (
                    <Link href={`/u/${profile.handle}`} className="np-discussions-author">
                      {profile.avatarUrl ? (
                        <img
                          src={profile.avatarUrl}
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
                      @{profile.handle}
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

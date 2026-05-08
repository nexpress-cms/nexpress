import { findDocuments, getMemberProfile } from "@nexpress/core";
import { buildPageMetadata } from "@nexpress/next";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ensureFor } from "@/lib/init-core";

interface ProfileDiscussionsPageProps {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ page?: string }>;
}

const PAGE_SIZE = 20;

export async function generateMetadata({
  params,
}: ProfileDiscussionsPageProps): Promise<Metadata> {
  await ensureFor("read");
  const { handle } = await params;
  const profile = await getMemberProfile(handle);
  if (!profile) return {};
  return buildPageMetadata({
    title: `Discussions by @${profile.handle}`,
    description: `Discussion threads started by ${profile.displayName}.`,
    path: `/u/${profile.handle}/discussions`,
  });
}

export default async function ProfileDiscussionsPage({
  params,
  searchParams,
}: ProfileDiscussionsPageProps) {
  await ensureFor("read");
  const { handle } = await params;
  const profile = await getMemberProfile(handle);
  if (!profile) notFound();

  const { page: pageRaw } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);

  // Public profile view shows only published threads — pending /
  // draft / archived rows are private to the author and the
  // /discussions index already handles those via `?author=me`.
  const result = await findDocuments("discussions", {
    where: {
      memberAuthorId: profile.id,
      status: "published",
    },
    sort: "-createdAt",
    page: pageNum,
    limit: PAGE_SIZE,
  });

  return (
    <article
      className="np-profile-discussions"
      style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1.5rem" }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            width={48}
            height={48}
            style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : null}
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>
            Discussions by{" "}
            <Link href={`/u/${profile.handle}`}>@{profile.handle}</Link>
          </h1>
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.875rem" }}>
            {result.totalDocs} {result.totalDocs === 1 ? "thread" : "threads"}
          </p>
        </div>
      </header>

      {result.docs.length === 0 ? (
        <p style={{ marginTop: "2rem", color: "#64748b" }}>
          @{profile.handle} hasn&apos;t started any discussions yet.
        </p>
      ) : (
        <ul
          className="np-profile-discussions-list"
          style={{ listStyle: "none", padding: 0, marginTop: "2rem" }}
        >
          {result.docs.map((doc) => {
            const slug = doc.slug as string;
            const title = doc.title as string;
            const createdAt = doc.createdAt as Date;
            return (
              <li
                key={doc.id as string}
                style={{
                  padding: "1rem 0",
                  borderBottom: "1px solid #e2e8f0",
                }}
              >
                <h2 style={{ fontSize: "1rem", margin: 0 }}>
                  <Link href={`/discussions/${slug}`}>{title}</Link>
                </h2>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    color: "#64748b",
                    fontSize: "0.8125rem",
                  }}
                >
                  <time dateTime={createdAt.toISOString()}>
                    {createdAt.toLocaleDateString()}
                  </time>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {result.totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "2rem",
            color: "#64748b",
            fontSize: "0.875rem",
          }}
        >
          {result.hasPrevPage ? (
            <Link href={`/u/${profile.handle}/discussions?page=${pageNum - 1}`}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {pageNum} of {result.totalPages}
          </span>
          {result.hasNextPage ? (
            <Link href={`/u/${profile.handle}/discussions?page=${pageNum + 1}`}>
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </article>
  );
}

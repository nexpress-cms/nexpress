import { findDocuments, getMemberProfile } from "@nexpress/core";
import { buildPageMetadata } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PaginationNav } from "../components/pagination-nav.js";
import type { DiscussionsDocument } from "./list.js";

const PAGE_SIZE = 20;

// React's per-request cache so metadata + render share a single
// member lookup. Without this the metadata builder and the page
// component would each issue an identical DB read for the same
// handle on every request.
const cachedGetMemberProfile = cache(getMemberProfile);

export async function profileDiscussionsMetadata(ctx: NpRouteRenderProps): Promise<Metadata> {
  const handle = typeof ctx.params.handle === "string" ? ctx.params.handle : "";
  if (!handle) return {};
  const profile = await cachedGetMemberProfile(handle);
  if (!profile) return {};
  return buildPageMetadata({
    title: `Discussions by @${profile.handle}`,
    description: `Discussion threads started by ${profile.displayName}.`,
    path: `/u/${profile.handle}/discussions`,
  });
}

export default async function ProfileDiscussionsRoute({
  params,
  searchParams,
}: NpRouteRenderProps) {
  const handle = typeof params.handle === "string" ? params.handle : "";
  if (!handle) notFound();

  const profile = await cachedGetMemberProfile(handle);
  if (!profile) notFound();

  const sp = searchParams ?? {};
  const rawPage =
    typeof sp.page === "string" ? sp.page : Array.isArray(sp.page) ? sp.page[0] : undefined;
  const pageNum = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

  // Public profile view shows only published threads — pending /
  // draft / archived rows are private to the author and the
  // /discussions index already handles those via `?author=me`.
  const result = await findDocuments<DiscussionsDocument>("discussions", {
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
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
        ) : null}
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>
            Discussions by <Link href={`/u/${profile.handle}`}>@{profile.handle}</Link>
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
          {result.docs.map((doc) => (
            <li
              key={doc.id}
              style={{
                padding: "1rem 0",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              <h2 style={{ fontSize: "1rem", margin: 0 }}>
                <Link href={`/discussions/${doc.slug}`}>{doc.title}</Link>
              </h2>
              <p
                style={{
                  margin: "0.25rem 0 0",
                  color: "#64748b",
                  fontSize: "0.8125rem",
                }}
              >
                <time dateTime={doc.createdAt.toISOString()}>
                  {doc.createdAt.toLocaleDateString()}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}

      <PaginationNav
        page={pageNum}
        totalPages={result.totalPages}
        hasPrevPage={result.hasPrevPage}
        hasNextPage={result.hasNextPage}
        hrefForPage={(p) => `/u/${profile.handle}/discussions?page=${p}`}
      />
    </article>
  );
}

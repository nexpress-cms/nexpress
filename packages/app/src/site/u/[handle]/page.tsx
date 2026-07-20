import {
  buildPersonJsonLd,
  getMemberProfile,
  getSiteSeoSettings,
  NpNotFoundError,
} from "@nexpress/core";
import { listMemberProfileActivity, npToPublicMemberProfileWire } from "@nexpress/core/community";
import type { NpMemberProfileActivityKind } from "@nexpress/core/community-contract";
import { getCurrentLocale } from "@nexpress/core/i18n";
import { JsonLd } from "@nexpress/next";
import { getActiveTheme, type NpThemeMemberProfileProps } from "@nexpress/theme";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, type ComponentProps } from "react";

import { FollowButton } from "../../../components/follow-button";
import { PublicMemberProfile } from "../../../components/public-member-profile";
import { ShellWrap } from "../../../components/shell-wrap";
import { ensureFor } from "../../../lib/init-core";

export const dynamic = "force-dynamic";

const getPublicProfile = cache((handle: string) =>
  getMemberProfile(handle, { avatarVariant: "small" }),
);

interface ProfilePageProps {
  params: Promise<{ handle: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function oneParam(
  searchParams: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = searchParams[name];
  if (Array.isArray(value)) notFound();
  return value ?? null;
}

function parseProfileQuery(searchParams: Record<string, string | string[] | undefined>): {
  kind: NpMemberProfileActivityKind;
  page: number;
} {
  if (Object.keys(searchParams).some((key) => key !== "activity" && key !== "page")) notFound();
  const activity = oneParam(searchParams, "activity") ?? "documents";
  if (activity !== "documents" && activity !== "comments") notFound();
  const rawPage = oneParam(searchParams, "page");
  if (rawPage === null) return { kind: activity, page: 1 };
  if (!/^[1-9]\d*$/u.test(rawPage)) notFound();
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page > 10_000) notFound();
  return { kind: activity, page };
}

function profileActivityHref(handle: string, kind: NpMemberProfileActivityKind, page = 1): string {
  const base = `/u/${encodeURIComponent(handle)}`;
  const params = new URLSearchParams();
  if (kind !== "documents") params.set("activity", kind);
  if (page > 1) params.set("page", page.toString());
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

function profileCopy(locale: string): {
  labels: NpThemeMemberProfileProps["labels"];
  follow: NonNullable<ComponentProps<typeof FollowButton>["labels"]>;
} {
  if (locale.toLowerCase().startsWith("ko")) {
    return {
      labels: {
        member: "커뮤니티 회원",
        comment: "댓글",
        documents: "게시글",
        comments: "댓글",
        emptyBio: "공개 소개가 아직 없습니다.",
        emptyDocuments: "공개 게시글이 아직 없습니다.",
        emptyComments: "공개 댓글이 아직 없습니다.",
        previous: "이전",
        next: "다음",
        memberSince: "가입일",
        reputation: "평판",
        activityNavigation: "회원 활동",
        paginationNavigation: "활동 페이지",
      },
      follow: {
        loading: "불러오는 중…",
        signedOut: "로그인하고 팔로우",
        follow: "팔로우",
        following: "팔로잉",
        actionFailed: "요청을 처리하지 못했습니다.",
      },
    };
  }
  return {
    labels: {
      member: "Community member",
      comment: "Comment",
      documents: "Posts",
      comments: "Comments",
      emptyBio: "No public bio yet.",
      emptyDocuments: "No public posts yet.",
      emptyComments: "No public comments yet.",
      previous: "Previous",
      next: "Next",
      memberSince: "Member since",
      reputation: "Reputation",
      activityNavigation: "Member activity",
      paginationNavigation: "Activity pagination",
    },
    follow: {
      loading: "Loading…",
      signedOut: "Log in to follow",
      follow: "Follow",
      following: "Following",
      actionFailed: "Action failed",
    },
  };
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  await ensureFor("read");
  const { handle } = await params;
  const profile = await getPublicProfile(handle);
  if (!profile) return {};
  return {
    title: `${profile.displayName} (@${profile.handle})`,
    description: profile.bio ?? `${profile.displayName}'s profile.`,
  };
}

export default async function PublicProfilePage({ params, searchParams }: ProfilePageProps) {
  await ensureFor("read");
  const [{ handle }, rawSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({}),
  ]);
  const query = parseProfileQuery(rawSearchParams);
  const profile = await getPublicProfile(handle);
  if (!profile) notFound();
  const activity = await listMemberProfileActivity(profile.id, {
    kind: query.kind,
    page: query.page,
    limit: 20,
  }).catch((error: unknown) => {
    if (error instanceof NpNotFoundError) notFound();
    throw error;
  });
  if (query.page > 1 && (activity.totalPages === 0 || query.page > activity.totalPages)) notFound();

  const settings = await getSiteSeoSettings();
  const personJsonLd = await buildPersonJsonLd({
    url: `${settings.siteUrl.replace(/\/+$/u, "")}/u/${profile.handle}`,
    name: profile.displayName,
    alternateName: `@${profile.handle}`,
    image: profile.avatarUrl,
    description: profile.bio,
  });
  const activeTheme = await getActiveTheme();
  const ProfileView = activeTheme?.impl.members?.publicProfile ?? PublicMemberProfile;
  const locale = getCurrentLocale();
  const copy = profileCopy(locale);
  const viewProps: NpThemeMemberProfileProps = {
    profile: npToPublicMemberProfileWire(profile),
    activity,
    followAction: <FollowButton memberId={profile.id} labels={copy.follow} />,
    locale,
    links: {
      documents: profileActivityHref(profile.handle, "documents"),
      comments: profileActivityHref(profile.handle, "comments"),
      previous: activity.hasPrevPage
        ? profileActivityHref(profile.handle, query.kind, query.page - 1)
        : null,
      next: activity.hasNextPage
        ? profileActivityHref(profile.handle, query.kind, query.page + 1)
        : null,
    },
    labels: copy.labels,
  };

  return (
    <ShellWrap surface="site">
      <JsonLd data={personJsonLd as unknown as Record<string, unknown>} />
      <ProfileView {...viewProps} />
    </ShellWrap>
  );
}

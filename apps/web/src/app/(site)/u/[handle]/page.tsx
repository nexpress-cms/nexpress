import { buildPersonJsonLd, getMemberProfile, getSiteSeoSettings } from "@nexpress/core";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FollowButton } from "@/components/follow-button";
import { ShellWrap } from "@/components/shell-wrap";
import { JsonLd } from "@nexpress/next";
import { ensureFor } from "@/lib/init-core";

export const dynamic = "force-dynamic";

interface ProfilePageProps {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  await ensureFor("read");
  const { handle } = await params;
  const profile = await getMemberProfile(handle);
  if (!profile) return {};
  return {
    title: `${profile.displayName} (@${profile.handle})`,
    description: profile.bio ?? `${profile.displayName}'s profile.`,
  };
}

export default async function PublicProfilePage({ params }: ProfilePageProps) {
  await ensureFor("read");
  const { handle } = await params;
  // Render the detail-page avatar at full size; default thumbnail
  // would look pixelated next to a 64px frame.
  const profile = await getMemberProfile(handle, { avatarVariant: "small" });
  if (!profile) notFound();

  const settings = await getSiteSeoSettings();
  const personJsonLd = await buildPersonJsonLd({
    url: `${settings.siteUrl.replace(/\/+$/, "")}/u/${profile.handle}`,
    name: profile.displayName,
    alternateName: `@${profile.handle}`,
    image: profile.avatarUrl,
    description: profile.bio,
  });

  return (
    <ShellWrap surface="site">
      <article
        className="np-member-profile"
        style={{ maxWidth: 640, margin: "3rem auto", padding: "0 1.5rem" }}
      >
        <JsonLd data={personJsonLd as unknown as Record<string, unknown>} />
        <header style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={`@${profile.handle}`}
              width={64}
              height={64}
              style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#e2e8f0",
                display: "grid",
                placeItems: "center",
                fontSize: "1.5rem",
                fontWeight: 600,
                color: "#475569",
              }}
              aria-hidden
            >
              {profile.displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{profile.displayName}</h1>
            <p style={{ margin: 0, color: "#64748b" }}>@{profile.handle}</p>
          </div>
          <FollowButton memberId={profile.id} />
        </header>
        {profile.bio ? <p style={{ marginTop: "1.5rem", lineHeight: 1.6 }}>{profile.bio}</p> : null}
        <p style={{ marginTop: "1.5rem", color: "#64748b", fontSize: "0.875rem" }}>
          Member since {profile.joinedAt.toLocaleDateString()} · Reputation {profile.reputation}
        </p>
      </article>
    </ShellWrap>
  );
}

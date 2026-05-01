import { buildPersonJsonLd, getSiteSeoSettings, nxMembers } from "@nexpress/core";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FollowButton } from "@/components/follow-button";
import { JsonLd } from "@/components/json-ld";
import { ensureFor } from "@/lib/init-core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ProfilePageProps {
  params: Promise<{ handle: string }>;
}

async function loadActiveMember(handle: string) {
  await ensureFor("read");
  const [row] = await getDb()
    .select({
      id: nxMembers.id,
      handle: nxMembers.handle,
      displayName: nxMembers.displayName,
      bio: nxMembers.bio,
      avatar: nxMembers.avatar,
      reputation: nxMembers.reputation,
      status: nxMembers.status,
      createdAt: nxMembers.createdAt,
    })
    .from(nxMembers)
    .where(eq(nxMembers.handle, handle.toLowerCase()))
    .limit(1);
  return row && row.status === "active" ? row : null;
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { handle } = await params;
  const member = await loadActiveMember(handle);
  if (!member) return {};
  return {
    title: `${member.displayName} (@${member.handle})`,
    description: member.bio ?? `${member.displayName}'s profile.`,
  };
}

export default async function PublicProfilePage({ params }: ProfilePageProps) {
  const { handle } = await params;
  const member = await loadActiveMember(handle);
  if (!member) notFound();

  const settings = await getSiteSeoSettings();
  const personJsonLd = await buildPersonJsonLd({
    url: `${settings.siteUrl.replace(/\/+$/, "")}/u/${member.handle}`,
    name: member.displayName,
    alternateName: `@${member.handle}`,
    image: typeof member.avatar === "string" ? member.avatar : null,
    description: member.bio ?? null,
  });

  return (
    <article className="nx-member-profile" style={{ maxWidth: 640, margin: "3rem auto", padding: "0 1.5rem" }}>
      <JsonLd data={personJsonLd as unknown as Record<string, unknown>} />
      <header style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
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
        >
          {member.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{member.displayName}</h1>
          <p style={{ margin: 0, color: "#64748b" }}>@{member.handle}</p>
        </div>
        <FollowButton memberId={member.id} />
      </header>
      {member.bio ? <p style={{ marginTop: "1.5rem", lineHeight: 1.6 }}>{member.bio}</p> : null}
      <p style={{ marginTop: "1.5rem", color: "#64748b", fontSize: "0.875rem" }}>
        Member since {new Date(member.createdAt).toLocaleDateString()} · Reputation {member.reputation}
      </p>
    </article>
  );
}

import { hashPassword, npMembers, npUsers, saveDocument } from "@nexpress/core";
import { npRequireAuthUser } from "@nexpress/core/auth-contract";
import { getSiteById, withCurrentSite } from "@nexpress/core/sites";
import { eq } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { communityPilot, ensureFor, getDb, shutdownBootstrap } from "../../src/lib/bootstrap.js";

const password = process.env.NP_COMMUNITY_PILOT_PASSWORD;
const staffId = process.env.NP_COMMUNITY_PILOT_STAFF_ID;
const output = process.argv[2];
if (!communityPilot || !password || !staffId || !output)
  throw new Error("Pilot setup is incomplete.");

try {
  await ensureFor("write");
  const db = getDb();
  const site = await getSiteById("default");
  if (!site?.settings.siteUrl || new URL(site.settings.siteUrl).origin !== process.env.SITE_URL) {
    throw new Error("The prepared site does not match the pilot deployment.");
  }
  const [staff] = await db.select().from(npUsers).where(eq(npUsers.id, staffId));
  if (!staff || staff.email !== "requester@example.test")
    throw new Error("Pilot staff is unavailable.");
  const user = npRequireAuthUser({
    id: staff.id,
    email: staff.email,
    name: staff.name,
    role: staff.role,
    tokenVersion: staff.tokenVersion,
  });
  const hash = await hashPassword(password);
  // Seed disposable accounts. The journey uses the ordinary password endpoints.
  await db.insert(npUsers).values({
    email: "approver@example.test",
    name: "Pilot Approver",
    password: hash,
    role: "admin",
    isSuperAdmin: true,
  });
  await db.insert(npMembers).values(
    ["member-one", "member-two", "member-three", "reporter"].map((handle) => ({
      handle,
      email: `${handle}@example.test`,
      displayName: handle,
      password: hash,
      status: "active" as const,
      emailVerified: true,
    })),
  );
  const boards = [];
  for (const [key, name] of [
    ["notice", "공지"],
    ["questions", "기술 질문"],
    ["general", "자유 게시판"],
  ]) {
    const { doc } = await withCurrentSite(site.id, () =>
      saveDocument(
        "forum-boards",
        null,
        {
          key,
          name,
          skin: "community-full",
          writeMode: key === "notice" ? "staff" : "members",
          audience: "public",
          moderation: "published",
          commentsEnabled: true,
        },
        user,
        { status: "published" },
      ),
    );
    boards.push({ key, id: doc.id });
  }
  await writeFile(
    output,
    `${JSON.stringify({ siteId: site.id, origin: process.env.SITE_URL, boards }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
} finally {
  await shutdownBootstrap();
}

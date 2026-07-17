import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 18 — community-table site scope (A plan).
 *
 * Members are global; comments / reactions / follows /
 * notifications / reports / mutes / bans / role-grants now carry
 * `site_id` so per-tenant queries don't leak cross-site rows.
 *
 * Tests pin the current site via `withCurrentSite()` from the
 * source tree (the test runner imports services through `dist`
 * AND through source paths in different places — using the same
 * source-side resolver everywhere keeps the module-level state
 * coherent; see Phase 17 tests for the same gymnastics).
 */
describe.skipIf(skipIfNoTestDb())("Phase 18 — community site scope", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  async function seedMember(handle: string): Promise<string> {
    const db = await getTestDb();
    const { hashPassword, npMembers } = await import("@nexpress/core");
    const password = await hashPassword("password-12345");
    const [row] = (await db
      .insert(npMembers)
      .values({
        email: `${handle}@example.com`,
        password,
        handle,
        displayName: handle,
        emailVerified: true,
        status: "active",
      })
      .returning({ id: npMembers.id })) as Array<{ id: string }>;
    return row.id;
  }

  async function seedStaffPostId(slug: string, siteId = "default"): Promise<string> {
    const session = await seedUser({ role: "admin" });
    const { saveDocument } = await import("@nexpress/core");
    const { withCurrentSite } = await import("@nexpress/core");
    const actor = {
      id: session.userId,
      email: session.email,
      name: "Test",
      role: session.role,
      tokenVersion: 0,
    };
    const out = await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        null,
        {
          title: `Mention target ${slug}`,
          slug,
          content: npCreateEmptyRichTextContent(),
        },
        actor,
        { status: "published" },
      ),
    );
    return (out.doc as { id: string }).id;
  }

  it("notification fan-out lands on the same tenant as the reaction target", async () => {
    // Issue #215 — the system used to allow cross-site
    // reactions and route the side-effects to the target's
    // tenant. After #215 cross-site writes are rejected
    // outright. The remaining invariant — that a reaction
    // performed under the same tenant as the target lands its
    // notification under that tenant — is what this test now
    // pins.
    const { withCurrentSite } = await import("@nexpress/core");
    const author = await seedMember("phase18a");
    const reactor = await seedMember("phase18b");
    const postId = await seedStaffPostId("p18-fanout", "default");

    const { createComment, addReaction, listNotifications } = await import("@nexpress/core");
    const comment = await withCurrentSite("default", () =>
      createComment({
        targetType: "posts",
        targetId: postId,
        memberId: author,
        bodyMd: "hello",
      }),
    );

    await withCurrentSite("default", () =>
      addReaction({
        memberId: reactor,
        targetType: "comment",
        targetId: comment.id,
        kind: "like",
      }),
    );

    const inbox = await withCurrentSite("default", () => listNotifications(author));
    expect(inbox.unread).toBe(1);
    expect(inbox.notifications[0]?.kind).toBe("reaction.received");
  });

  it("reports filed on one site don't appear in another site's queue", async () => {
    const { withCurrentSite } = await import("@nexpress/core");
    const reporter = await seedMember("phase18reporter");
    const target = await seedMember("phase18target");
    const { fileReport, listReports } = await import("@nexpress/core");

    await withCurrentSite("default", () =>
      fileReport({
        reporterId: reporter,
        targetType: "member",
        targetId: target,
        reason: "spam on default",
      }),
    );
    await withCurrentSite("tenant-b", () =>
      fileReport({
        reporterId: reporter,
        targetType: "member",
        targetId: target,
        reason: "spam on tenant-b",
      }),
    );

    const onDefault = await withCurrentSite("default", () => listReports({}));
    expect(onDefault.totalDocs).toBe(1);
    expect(onDefault.reports[0]?.reason).toBe("spam on default");

    const onB = await withCurrentSite("tenant-b", () => listReports({}));
    expect(onB.totalDocs).toBe(1);
    expect(onB.reports[0]?.reason).toBe("spam on tenant-b");

    // siteId: null surfaces both for super-admin triage.
    const all = await withCurrentSite("default", () => listReports({ siteId: null }));
    expect(all.totalDocs).toBe(2);
  });

  it("site-wide ban on tenant A does NOT block writes on tenant B", async () => {
    const session = await seedUser({ role: "admin" });
    const { withCurrentSite } = await import("@nexpress/core");
    const member = await seedMember("phase18banned");
    const { issueBan, assertNotBanned } = await import("@nexpress/core");
    const staffActor = {
      kind: "staff" as const,
      user: {
        id: session.userId,
        email: session.email,
        name: "Test",
        role: session.role,
        tokenVersion: 0,
      },
    };

    // Issue a site-wide ban on tenant A.
    await withCurrentSite("tenant-a", () =>
      issueBan({
        memberId: member,
        scopeType: "site",
        kind: "permanent",
        reason: "spamming",
        actor: staffActor,
      }),
    );

    // `assertNotBanned` throws on tenant A (banned) but
    // resolves on tenant B (no scope match).
    let aThrew = false;
    try {
      await withCurrentSite("tenant-a", () => assertNotBanned(member));
    } catch {
      aThrew = true;
    }
    expect(aThrew).toBe(true);
    await expect(
      withCurrentSite("tenant-b", () => assertNotBanned(member)),
    ).resolves.toBeUndefined();
  });

  it("role grant on tenant A does NOT authorize on tenant B", async () => {
    const session = await seedUser({ role: "admin" });
    const { withCurrentSite } = await import("@nexpress/core");
    const member = await seedMember("phase18mod");
    const { grantMemberRole, memberCan } = await import("@nexpress/core");

    // Grant community-mod on tenant A.
    await withCurrentSite("tenant-a", () =>
      grantMemberRole({
        memberId: member,
        role: "community-mod",
        scopeType: "site",
        grantedByUserId: session.userId,
      }),
    );

    // Tenant A: capability resolves.
    const canHideOnA = await withCurrentSite("tenant-a", () =>
      memberCan(member, "hide-comment", {
        type: "comment",
        id: "00000000-0000-0000-0000-000000000001",
        scopes: [{ type: "collection", id: "posts" }],
      }),
    );
    // Tenant B: same member, same role definition, different
    // tenant — no grant exists here so the check fails.
    const canHideOnB = await withCurrentSite("tenant-b", () =>
      memberCan(member, "hide-comment", {
        type: "comment",
        id: "00000000-0000-0000-0000-000000000001",
        scopes: [{ type: "collection", id: "posts" }],
      }),
    );
    expect(canHideOnA).toBe(true);
    expect(canHideOnB).toBe(false);
  });

  it("a comment inherits the target document's site_id under same-tenant writes", async () => {
    // Issue #215 — cross-tenant writes are rejected, but
    // same-tenant writes still need to surface `site_id` from
    // the target so a request that doesn't pin the resolver
    // (e.g. a script-driven seed) doesn't drop down to the
    // default. Tests the canonical-target propagation that
    // remained after the cross-tenant guard landed.
    const { withCurrentSite, createSite } = await import("@nexpress/core");
    await createSite({ id: "tenant-a", name: "A" });
    const author = await seedMember("phase18comment");
    const postId = await seedStaffPostId("p18-comment", "tenant-a");

    const { createComment } = await import("@nexpress/core");
    const comment = await withCurrentSite("tenant-a", () =>
      createComment({
        targetType: "posts",
        targetId: postId,
        memberId: author,
        bodyMd: "from a, landed on a",
      }),
    );

    const db = await getTestDb();
    const { npComments } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const [row] = (await db
      .select()
      .from(npComments)
      .where(eq(npComments.id, comment.id))) as Array<{ siteId: string }>;
    expect(row.siteId).toBe("tenant-a");
  });

  it("mutes are per-site: muting on A doesn't silence B", async () => {
    const { withCurrentSite } = await import("@nexpress/core");
    const muter = await seedMember("phase18muter");
    const noisy = await seedMember("phase18noisy");
    const { muteMember, isMuted } = await import("@nexpress/core");

    await withCurrentSite("site-a", () => muteMember({ memberId: muter, targetId: noisy }));

    const onA = await withCurrentSite("site-a", () =>
      isMuted({ memberId: muter, targetId: noisy }),
    );
    const onB = await withCurrentSite("site-b", () =>
      isMuted({ memberId: muter, targetId: noisy }),
    );
    expect(onA).toBe(true);
    expect(onB).toBe(false);
  });

  it("follows are per-site: following on A doesn't follow on B", async () => {
    const { withCurrentSite } = await import("@nexpress/core");
    const follower = await seedMember("phase18flwr");
    const target = await seedMember("phase18tgt");
    const { follow, isFollowing } = await import("@nexpress/core");

    await withCurrentSite("site-a", () =>
      follow({ followerId: follower, targetType: "member", targetId: target }),
    );

    const onA = await withCurrentSite("site-a", () =>
      isFollowing({ followerId: follower, targetType: "member", targetId: target }),
    );
    const onB = await withCurrentSite("site-b", () =>
      isFollowing({ followerId: follower, targetType: "member", targetId: target }),
    );
    expect(onA).toBe(true);
    expect(onB).toBe(false);
  });

  // ============== Issue #215 ==============

  it("Issue #215 — createComment rejects cross-site target documents", async () => {
    const { createSite, withCurrentSite } = await import("@nexpress/core");
    await createSite({ id: "site-x215", name: "X" });
    const member = await seedMember("phase215a");
    // Post lives on site-x215; the request runs under default.
    const postId = await seedStaffPostId("p215-cross", "site-x215");
    const { createComment } = await import("@nexpress/core");
    await expect(
      withCurrentSite("default", () =>
        createComment({
          targetType: "posts",
          targetId: postId,
          memberId: member,
          bodyMd: "should be rejected",
        }),
      ),
    ).rejects.toThrow(/Forbidden|cross-site/);
  });

  it("Issue #215 — addReaction rejects cross-site target comments", async () => {
    const { createSite, withCurrentSite } = await import("@nexpress/core");
    await createSite({ id: "site-x215b", name: "X" });
    const author = await seedMember("phase215b1");
    const reactor = await seedMember("phase215b2");
    // Comment lives on site-x215b.
    const postId = await seedStaffPostId("p215-react", "site-x215b");
    const { createComment, addReaction } = await import("@nexpress/core");
    const comment = await withCurrentSite("site-x215b", () =>
      createComment({
        targetType: "posts",
        targetId: postId,
        memberId: author,
        bodyMd: "owner",
      }),
    );
    await expect(
      withCurrentSite("default", () =>
        addReaction({
          targetType: "comment",
          targetId: comment.id,
          memberId: reactor,
          kind: "like",
        }),
      ),
    ).rejects.toThrow(/Forbidden|cross-site/);
  });

  it("Issue #219 — markNotificationsRead is scoped to the current site", async () => {
    const { createSite, withCurrentSite, createNotification, markNotificationsRead } =
      await import("@nexpress/core");
    await createSite({ id: "site-a219", name: "A" });
    await createSite({ id: "site-b219", name: "B" });
    const member = await seedMember("phase219");
    // One notification on each site for the same member. Both
    // calls return non-null because the member has no mutes /
    // disabled kinds — the `?? throw` keeps the test type-safe.
    const a = await withCurrentSite("site-a219", () =>
      createNotification({ memberId: member, kind: "system", payload: {} }),
    );
    const b = await withCurrentSite("site-b219", () =>
      createNotification({ memberId: member, kind: "system", payload: {} }),
    );
    if (!a || !b) throw new Error("createNotification returned null");

    // Run mark-read under site-a219 with both ids — should only
    // touch the site-a219 row, returning 1 (not 2).
    const updated = await withCurrentSite("site-a219", () =>
      markNotificationsRead({ memberId: member, notificationIds: [a.id, b.id] }),
    );
    expect(updated).toBe(1);

    // Confirm the site-b219 row is still unread.
    const { listNotifications } = await import("@nexpress/core");
    const listB = await withCurrentSite("site-b219", () =>
      listNotifications(member, { unreadOnly: true }),
    );
    expect(listB.notifications.some((n) => n.id === b.id)).toBe(true);
  });

  it("Issue #215 — fileReport rejects cross-site target comments", async () => {
    const { createSite, withCurrentSite } = await import("@nexpress/core");
    await createSite({ id: "site-x215c", name: "X" });
    const author = await seedMember("phase215c1");
    const reporter = await seedMember("phase215c2");
    const postId = await seedStaffPostId("p215-report", "site-x215c");
    const { createComment, fileReport } = await import("@nexpress/core");
    const comment = await withCurrentSite("site-x215c", () =>
      createComment({
        targetType: "posts",
        targetId: postId,
        memberId: author,
        bodyMd: "owner",
      }),
    );
    await expect(
      withCurrentSite("default", () =>
        fileReport({
          reporterId: reporter,
          targetType: "comment",
          targetId: comment.id,
          reason: "test",
        }),
      ),
    ).rejects.toThrow(/Forbidden|cross-site/);
  });
});

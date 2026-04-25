import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  nxBans,
  nxMemberRoles,
  nxMembers,
} from "../db/schema/community.js";
import { memberCan } from "../community/can.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  skipIfNoTestDb,
  truncateAll,
} from "./setup.js";

async function seedMember(
  db: NodePgDatabase<Record<string, unknown>>,
  overrides: Partial<{ handle: string; email: string; displayName: string }> = {},
): Promise<string> {
  const handle = overrides.handle ?? `m_${Math.random().toString(36).slice(2, 9)}`;
  const [row] = (await db
    .insert(nxMembers)
    .values({
      handle,
      email: overrides.email ?? `${handle}@example.com`,
      displayName: overrides.displayName ?? handle,
      // Seed members straight to active so the resolver doesn't have to
      // care about pending/email-verified state at all.
      status: "active",
    })
    .returning({ id: nxMembers.id })) as Array<{ id: string }>;
  if (!row) throw new Error("Failed to seed member");
  return row.id;
}

async function grant(
  db: NodePgDatabase<Record<string, unknown>>,
  memberId: string,
  role: string,
  scopeType: "site" | "category" | "collection" | "thread",
  scopeId: string | null,
  expiresAt: Date | null = null,
): Promise<void> {
  await db.insert(nxMemberRoles).values({ memberId, role, scopeType, scopeId, expiresAt });
}

async function ban(
  db: NodePgDatabase<Record<string, unknown>>,
  memberId: string,
  scopeType: "site" | "category" | "collection",
  scopeId: string | null,
  expiresAt: Date | null = null,
): Promise<void> {
  await db.insert(nxBans).values({
    memberId,
    scopeType,
    scopeId,
    kind: expiresAt ? "temporary" : "permanent",
    expiresAt,
  });
}

describe.skipIf(skipIfNoTestDb())("memberCan (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  beforeEach(async () => {
    // truncateAll() doesn't list community tables (added in 9.1a). Run an
    // explicit cascading wipe of the new tables here so each test starts
    // clean. Once 9.5 lands and the harness gets updated, this can move
    // back into truncateAll.
    await truncateAll();
    const db = await getTestDb();
    await db.execute(
      "truncate table nx_bans, nx_member_roles, nx_member_identities, nx_member_sessions, nx_members restart identity cascade" as never,
    );
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("denies an unprivileged member by default", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    const can = await memberCan(memberId, "hide-comment", { type: "comment", id: "c1" });
    expect(can).toBe(false);
  });

  it("allows the owner to edit-own; rejects a non-owner", async () => {
    const db = await getTestDb();
    const owner = await seedMember(db, { handle: "owner1" });
    const stranger = await seedMember(db, { handle: "stranger1" });

    expect(
      await memberCan(owner, "edit-own", { type: "comment", id: "c1", ownerId: owner }),
    ).toBe(true);
    expect(
      await memberCan(stranger, "edit-own", { type: "comment", id: "c1", ownerId: owner }),
    ).toBe(false);
  });

  it("site-wide community-mod grant unlocks every capability site-wide", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    await grant(db, memberId, "community-mod", "site", null);

    expect(await memberCan(memberId, "hide-comment", { type: "comment", id: "c1" })).toBe(true);
    expect(await memberCan(memberId, "ban-member", { type: "member", id: "m9" })).toBe(true);
    expect(
      await memberCan(memberId, "hide-thread", {
        type: "thread",
        id: "t1",
        scopes: [{ type: "category", id: "general" }],
      }),
    ).toBe(true);
  });

  it("category-mod grant scopes the capability to that category only", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    await grant(db, memberId, "category-mod", "category", "general");

    expect(
      await memberCan(memberId, "hide-thread", {
        type: "thread",
        id: "t1",
        scopes: [{ type: "category", id: "general" }],
      }),
    ).toBe(true);
    expect(
      await memberCan(memberId, "hide-thread", {
        type: "thread",
        id: "t2",
        scopes: [{ type: "category", id: "off-topic" }],
      }),
    ).toBe(false);
  });

  it("collection-mod grant scopes comment-moderation to one collection slug", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    await grant(db, memberId, "collection-mod", "collection", "posts");

    expect(
      await memberCan(memberId, "hide-comment", {
        type: "comment",
        id: "c1",
        scopes: [{ type: "collection", id: "posts" }],
      }),
    ).toBe(true);
    expect(
      await memberCan(memberId, "hide-comment", {
        type: "comment",
        id: "c2",
        scopes: [{ type: "collection", id: "pages" }],
      }),
    ).toBe(false);
    // Collection-mods must not gain thread powers.
    expect(
      await memberCan(memberId, "lock-thread", {
        type: "thread",
        id: "t1",
        scopes: [{ type: "collection", id: "posts" }],
      }),
    ).toBe(false);
  });

  it("a site-wide ban denies every action even when the member holds grants", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    await grant(db, memberId, "community-mod", "site", null);
    await ban(db, memberId, "site", null);

    expect(await memberCan(memberId, "hide-comment", { type: "comment", id: "c1" })).toBe(false);
    // edit-own also blocked under a site ban.
    expect(
      await memberCan(memberId, "edit-own", { type: "comment", id: "c1", ownerId: memberId }),
    ).toBe(false);
  });

  it("a scoped ban applies only when the target is in that scope", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    await grant(db, memberId, "community-mod", "site", null);
    await ban(db, memberId, "category", "off-topic");

    // Banned in `off-topic`: deny.
    expect(
      await memberCan(memberId, "hide-thread", {
        type: "thread",
        id: "t1",
        scopes: [{ type: "category", id: "off-topic" }],
      }),
    ).toBe(false);
    // Other categories: allow (community-mod still applies).
    expect(
      await memberCan(memberId, "hide-thread", {
        type: "thread",
        id: "t2",
        scopes: [{ type: "category", id: "general" }],
      }),
    ).toBe(true);
  });

  it("an expired grant does not apply", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    await grant(db, memberId, "community-mod", "site", null, new Date(Date.now() - 60_000));

    expect(await memberCan(memberId, "hide-comment", { type: "comment", id: "c1" })).toBe(false);
  });

  it("an expired ban does not apply", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    await grant(db, memberId, "community-mod", "site", null);
    await ban(db, memberId, "site", null, new Date(Date.now() - 60_000));

    expect(await memberCan(memberId, "hide-comment", { type: "comment", id: "c1" })).toBe(true);
  });

  it("thread-author grants edit-own-thread on the owned thread but not others", async () => {
    const db = await getTestDb();
    const memberId = await seedMember(db);
    await grant(db, memberId, "thread-author", "thread", "t1");

    expect(
      await memberCan(memberId, "edit-own-thread", {
        type: "thread",
        id: "t1",
        scopes: [{ type: "thread", id: "t1" }],
      }),
    ).toBe(true);
    expect(
      await memberCan(memberId, "edit-own-thread", {
        type: "thread",
        id: "t2",
        scopes: [{ type: "thread", id: "t2" }],
      }),
    ).toBe(false);
  });
});

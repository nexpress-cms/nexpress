import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import {
  GET as collectionGET,
  POST as collectionPOST,
} from "@/app/api/collections/[slug]/route";
import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";

import { NextRequest } from "next/server";

import type { NxReputationEvent } from "@nexpress/core";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function memberRequest(
  path: string,
  member: { sessionCookie: string; csrfCookie: string },
  init: RequestInit = {},
): NextRequest {
  return jsonRequest(path, {
    ...init,
    cookies: [`nx-mb-session=${member.sessionCookie}`, `nx-mb-csrf=${member.csrfCookie}`],
    headers: { ...(init.headers ?? {}), "x-csrf-token": member.csrfCookie },
  });
}

function cookieValue(setCookie: string | string[] | null, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const line of headers) {
    const m = new RegExp(`${name}=([^;]+)`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

async function seedActiveMember(
  handle: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const password = "password-12345";
  const email = `${handle}@example.com`;
  await registerPOST(
    jsonRequest("/api/members/register", {
      method: "POST",
      body: JSON.stringify({ email, password, handle, displayName: handle }),
    }),
  );
  const db = await getTestDb();
  const { createMemberEmailVerifyToken, nxMembers } = await import("@nexpress/core");
  const { eq } = await import("drizzle-orm");
  const [row] = (await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.handle, handle))
    .limit(1)) as Array<{ id: string }>;
  const issued = await createMemberEmailVerifyToken(db as never, row.id, 60_000);
  await verifyPOST(
    jsonRequest("/api/members/verify", {
      method: "POST",
      body: JSON.stringify({ token: issued.token }),
    }),
  );
  const login = await loginPOST(
    jsonRequest("/api/members/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  );
  const setCookies = login.headers.get("set-cookie");
  return {
    memberId: row.id,
    sessionCookie: cookieValue(setCookies, "nx-mb-session")!,
    csrfCookie: cookieValue(setCookies, "nx-mb-csrf")!,
  };
}

async function memberCreate(
  member: { sessionCookie: string; csrfCookie: string },
  body: { title: string; slug: string },
): Promise<Response> {
  return collectionPOST(
    memberRequest("/api/collections/discussions", member, {
      method: "POST",
      body: JSON.stringify({
        title: body.title,
        slug: body.slug,
        body: { root: { type: "root", children: [] } },
      }),
    }),
    { params: Promise.resolve({ slug: "discussions" }) },
  );
}

describe.skipIf(skipIfNoTestDb())("member-write moderation gate (Phase 9.7c)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    // We register two flavors of the discussions collection in
    // turn — `defaultStatus="published"` for the spam-adapter
    // tests, then re-register with `defaultStatus="pending"` for
    // the gate tests. `registerCollection` overwrites in place so
    // we can flip it from each `beforeEach`.
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    const core = await import("@nexpress/core");
    core.resetSpamAdapter();
    core.resetReputationAdapter();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  async function registerDiscussionsWith(defaultStatus: "published" | "pending"): Promise<void> {
    const { defineDiscussionsCollection } = await import("@nexpress/plugin-forum");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    const config = defineDiscussionsCollection();
    // Override defaultStatus on top of the forum-plugin defaults
    // (which omit it → "published").
    const community = {
      ...(config.community ?? {}),
      memberWrite: {
        ...(config.community?.memberWrite ?? {}),
        defaultStatus,
      },
    };
    registerCollection(
      "discussions",
      discussionsTable as never,
      { ...config, community, access: undefined, hooks: undefined },
    );
  }

  describe("defaultStatus", () => {
    it("default `published` (current 9.7a behavior) — member create lands published", async () => {
      await registerDiscussionsWith("published");
      const member = await seedActiveMember("def-pub");
      const res = await memberCreate(member, { title: "Hello", slug: "hello-pub" });
      const body = await readJson<{ status: string }>(res);
      expect(body.status).toBe(201);
      expect(body.body.status).toBe("published");
    });

    it("`pending` default — member create lands pending; public list filters it out", async () => {
      await registerDiscussionsWith("pending");
      const member = await seedActiveMember("def-pend");
      const res = await memberCreate(member, { title: "Awaits review", slug: "wait-1" });
      const body = await readJson<{ status: string; id: string }>(res);
      expect(body.status).toBe(201);
      expect(body.body.status).toBe("pending");

      // Anonymous public list filters to status=published — pending row hidden.
      const list = await collectionGET(
        jsonRequest("/api/collections/discussions"),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
      const listBody = await readJson<{ totalDocs: number }>(list);
      expect(listBody.body.totalDocs).toBe(0);
    });

    it("pending creates do NOT credit `document.created` reputation", async () => {
      await registerDiscussionsWith("pending");
      const core = await import("@nexpress/core");
      const events: NxReputationEvent[] = [];
      core.setReputationAdapter({
        apply: (event) => {
          events.push(event);
          return event.kind === "document.created" ? 5 : 0;
        },
      });

      const member = await seedActiveMember("rep-pend");
      const res = await memberCreate(member, { title: "Pending", slug: "rep-pending" });
      expect(res.status).toBe(201);

      // No document.created event — pending docs wait on a mod
      // restore before earning reputation.
      expect(events).toHaveLength(0);
      const db = await getTestDb();
      const { nxMembers } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select({ reputation: nxMembers.reputation })
        .from(nxMembers)
        .where(eq(nxMembers.id, member.memberId))
        .limit(1)) as Array<{ reputation: number }>;
      expect(row.reputation).toBe(0);
    });
  });

  describe("spam adapter on doc creates", () => {
    beforeEach(async () => {
      await registerDiscussionsWith("published");
    });

    it("`pass` verdict — create lands at defaultStatus (published)", async () => {
      const core = await import("@nexpress/core");
      core.setSpamAdapter({ check: () => ({ kind: "pass" }) });

      const member = await seedActiveMember("spam-pass");
      const res = await memberCreate(member, { title: "Genuine", slug: "spam-pass-1" });
      const body = await readJson<{ status: string }>(res);
      expect(body.status).toBe(201);
      expect(body.body.status).toBe("published");
    });

    it("`flag` verdict — create lands `pending` regardless of defaultStatus", async () => {
      const core = await import("@nexpress/core");
      core.setSpamAdapter({
        check: () => ({ kind: "flag", reason: "low rep", metadata: { score: 0.7 } }),
      });

      const member = await seedActiveMember("spam-flag");
      const res = await memberCreate(member, { title: "Suspicious title", slug: "spam-flag-1" });
      const body = await readJson<{ status: string; id: string }>(res);
      expect(body.status).toBe(201);
      expect(body.body.status).toBe("pending");

      // Audit captured `document.flag` (not `document.create`) with metadata.
      const db = await getTestDb();
      const { nxAuditEvents } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const audits = (await db
        .select()
        .from(nxAuditEvents)
        .where(eq(nxAuditEvents.action, "document.flag"))) as Array<{
        actorMemberId: string | null;
        targetType: string | null;
        payload: Record<string, unknown>;
      }>;
      expect(audits).toHaveLength(1);
      expect(audits[0].actorMemberId).toBe(member.memberId);
      expect(audits[0].targetType).toBe("discussions");
      const verdict = audits[0].payload.spamVerdict as Record<string, unknown> | undefined;
      expect(verdict).toBeDefined();
      expect(verdict?.score).toBe(0.7);
    });

    it("`reject` verdict — write refused with 400, no row inserted", async () => {
      const core = await import("@nexpress/core");
      core.setSpamAdapter({
        check: () => ({ kind: "reject", reason: "Detected as spam by Akismet" }),
      });

      const member = await seedActiveMember("spam-reject");
      const res = await memberCreate(member, { title: "Buy cheap pills", slug: "spam-rej-1" });
      expect(res.status).toBe(400);
      const body = await readJson<{
        error?: { details?: Array<{ message?: string }> };
      }>(res);
      expect(body.body.error?.details?.[0]?.message).toContain("Akismet");

      // No row inserted — public list (and admin list) is empty.
      const db = await getTestDb();
      const { discussionsTable } = await import("@/db/generated/collections");
      const rows = (await db.select().from(discussionsTable)) as Array<unknown>;
      expect(rows).toHaveLength(0);
    });

    it("adapter that throws is treated as pass (fail-open)", async () => {
      const core = await import("@nexpress/core");
      core.setSpamAdapter({
        check: () => {
          throw new Error("upstream unavailable");
        },
      });

      const member = await seedActiveMember("spam-throw");
      const res = await memberCreate(member, { title: "Genuine", slug: "spam-fo-1" });
      const body = await readJson<{ status: string }>(res);
      expect(body.status).toBe(201);
      // Fail-open lands the doc at the configured default
      // (`published` here), same policy as comments.
      expect(body.body.status).toBe("published");
    });

    it("`flag` overrides `defaultStatus=published` (per-row flag wins)", async () => {
      // Already at defaultStatus=published from beforeEach. Confirm
      // the spam adapter can downgrade an individual row.
      const core = await import("@nexpress/core");
      core.setSpamAdapter({ check: () => ({ kind: "flag" }) });

      const member = await seedActiveMember("spam-flag-pub");
      const res = await memberCreate(member, { title: "Sus", slug: "spam-flag-2" });
      const body = await readJson<{ status: string }>(res);
      expect(body.body.status).toBe("pending");
    });

    it("flagged creates do NOT credit reputation (mirrors comment.flag)", async () => {
      const core = await import("@nexpress/core");
      core.setSpamAdapter({ check: () => ({ kind: "flag" }) });
      const events: NxReputationEvent[] = [];
      core.setReputationAdapter({
        apply: (event) => {
          events.push(event);
          return 5;
        },
      });

      const member = await seedActiveMember("spam-flag-rep");
      const res = await memberCreate(member, { title: "Sus", slug: "spam-flag-rep-1" });
      expect(res.status).toBe(201);
      expect(events).toHaveLength(0);
    });
  });
});

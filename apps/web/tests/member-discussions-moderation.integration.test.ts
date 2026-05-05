import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedActiveMember as harnessSeedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import {
  GET as collectionGET,
  POST as collectionPOST,
} from "@/app/api/collections/[slug]/route";
import { PATCH as collectionPATCH } from "@/app/api/collections/[slug]/[id]/route";

import { NextRequest } from "next/server";

import type { NpReputationEvent } from "@nexpress/core";

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
    cookies: [`np-mb-session=${member.sessionCookie}`, `np-mb-csrf=${member.csrfCookie}`],
    headers: { ...(init.headers ?? {}), "x-csrf-token": member.csrfCookie },
  });
}

async function seedActiveMember(
  handle: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const session = await harnessSeedActiveMember({ handle });
  return {
    memberId: session.memberId,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
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
      const events: NpReputationEvent[] = [];
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
      const { npMembers } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select({ reputation: npMembers.reputation })
        .from(npMembers)
        .where(eq(npMembers.id, member.memberId))
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
      const { npAuditEvents } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const audits = (await db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "document.flag"))) as Array<{
        actorMemberId: string | null;
        targetType: string | null;
        payload: Record<string, unknown>;
      }>;
      expect(audits).toHaveLength(1);
      expect(audits[0].actorMemberId).toBe(member.memberId);
      expect(audits[0].targetType).toBe("discussions");
      // Phase 9.7n widened the audit payload: `spamVerdict` is now
      // `{ reason, metadata }` (so a sibling `profanityVerdict` can
      // carry the same shape). The adapter's metadata lives under
      // `spamVerdict.metadata`.
      const verdict = audits[0].payload.spamVerdict as
        | { reason: string | null; metadata: Record<string, unknown> | null }
        | undefined;
      expect(verdict).toBeDefined();
      expect(verdict?.metadata).toEqual({ score: 0.7 });
      expect(audits[0].payload.sources).toEqual(["spam"]);
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

    // Regression: a `flag` verdict with no `metadata` must still
    // record `document.flag` (the audit action discriminates on the
    // verdict kind, not on whether the adapter chose to attach
    // metadata). Earlier draft used `metadata !== undefined` as the
    // proxy for flag-ness and silently mis-labelled metadata-less
    // flags as `document.create`.
    it("`flag` with no metadata still records `document.flag` audit", async () => {
      const core = await import("@nexpress/core");
      core.setSpamAdapter({ check: () => ({ kind: "flag" }) });

      const member = await seedActiveMember("flag-no-meta");
      const res = await memberCreate(member, { title: "Sus", slug: "flag-no-meta-1" });
      expect(res.status).toBe(201);

      const db = await getTestDb();
      const { npAuditEvents } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const flag = (await db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "document.flag"))) as Array<unknown>;
      const create = (await db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "document.create"))) as Array<unknown>;
      expect(flag).toHaveLength(1);
      expect(create).toHaveLength(0);
    });

    // Regression: a config-driven `pending` (defaultStatus="pending"
    // with no spam adapter installed, or `pass` verdict) must NOT
    // be recorded as `document.flag` — that audit action is reserved
    // for spam-adapter-flagged rows so mods can tell "this needs
    // review because the adapter said so" from "this is in the
    // moderation queue because the site is invite-style."
    it("config `pending` (no spam flag) records `document.create` not `document.flag`", async () => {
      // Switch to defaultStatus=pending for this test.
      await registerDiscussionsWith("pending");

      const member = await seedActiveMember("config-pending");
      const res = await memberCreate(member, { title: "Awaits", slug: "config-pending-1" });
      const body = await readJson<{ status: string }>(res);
      expect(body.body.status).toBe("pending");

      const db = await getTestDb();
      const { npAuditEvents } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const flag = (await db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "document.flag"))) as Array<unknown>;
      const create = (await db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "document.create"))) as Array<unknown>;
      expect(flag).toHaveLength(0);
      expect(create).toHaveLength(1);
    });

    it("flagged creates do NOT credit reputation (mirrors comment.flag)", async () => {
      const core = await import("@nexpress/core");
      core.setSpamAdapter({ check: () => ({ kind: "flag" }) });
      const events: NpReputationEvent[] = [];
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

  // Issues #119 + #121 — moderation must scan rich-text body
  // (not just the title) AND must re-run on owner edits, not
  // just on the create path.
  describe("moderation gate widens beyond create-time titles", () => {
    beforeEach(async () => {
      await registerDiscussionsWith("published");
    });

    it("rich-text body is fed to the adapters (#119)", async () => {
      // The adapter only sees `body` — title is benign. Pre-fix
      // `moderationText = data.title` only, so this row would have
      // landed `published`. With the body-extraction fix it should
      // land `pending`.
      const seen: string[] = [];
      const core = await import("@nexpress/core");
      core.setProfanityAdapter({
        check: (text) => {
          seen.push(text);
          return text.includes("badword")
            ? { kind: "flag", reason: "lexicon" }
            : { kind: "pass" };
        },
      });

      const member = await seedActiveMember("body-prof");
      const res = await collectionPOST(
        memberRequest("/api/collections/discussions", member, {
          method: "POST",
          body: JSON.stringify({
            title: "Innocent title",
            slug: "innocent-1",
            body: {
              root: {
                type: "root",
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "this contains badword inside" }],
                  },
                ],
              },
            },
          }),
        }),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
      expect(res.status).toBe(201);
      const body = await readJson<{ status: string }>(res);
      expect(body.body.status).toBe("pending");

      // Sanity: the adapter actually saw the body bytes.
      expect(seen.some((t) => t.includes("badword"))).toBe(true);
    });

    it("clean create then flagged edit demotes to pending (#121)", async () => {
      const core = await import("@nexpress/core");
      // Adapter is pass-through during create, then we flip it to
      // flag for the edit. Mirrors the realistic threat: a member
      // gets a clean post published and then PATCHes spam in.
      core.setSpamAdapter({ check: () => ({ kind: "pass" }) });

      const member = await seedActiveMember("edit-flag");
      const create = await memberCreate(member, {
        title: "Clean original",
        slug: "edit-flag-1",
      });
      const created = await readJson<{ id: string; status: string }>(create);
      expect(created.body.status).toBe("published");
      const docId = created.body.id;

      core.setSpamAdapter({
        check: () => ({
          kind: "flag",
          reason: "low rep",
          metadata: { score: 0.7 },
        }),
      });

      const patch = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({ title: "Newly flagged content" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(patch.status).toBe(200);
      const patched = await readJson<{ status: string }>(patch);
      expect(patched.body.status).toBe("pending");

      // Audit trail records the flag with `event: "update"` so a
      // mod scanning `document.flag` rows can tell create-flags
      // from edit-flags.
      const db = await getTestDb();
      const { npAuditEvents } = await import("@nexpress/core");
      const { and, eq } = await import("drizzle-orm");
      const audits = (await db
        .select()
        .from(npAuditEvents)
        .where(
          and(
            eq(npAuditEvents.action, "document.flag"),
            eq(npAuditEvents.targetId, docId),
          ),
        )) as Array<{ payload: Record<string, unknown> }>;
      expect(audits).toHaveLength(1);
      expect(audits[0].payload.event).toBe("update");
      expect(audits[0].payload.sources).toEqual(["spam"]);
    });

    it("edit with reject verdict refuses the patch (#121)", async () => {
      const core = await import("@nexpress/core");
      core.setSpamAdapter({ check: () => ({ kind: "pass" }) });

      const member = await seedActiveMember("edit-reject");
      const create = await memberCreate(member, {
        title: "Clean",
        slug: "edit-reject-1",
      });
      const docId = (await readJson<{ id: string }>(create)).body.id;

      core.setSpamAdapter({
        check: () => ({ kind: "reject", reason: "Detected as spam" }),
      });

      const patch = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({ title: "Spam edit" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(patch.status).toBe(400);

      // Sanity: the row's title is NOT updated — the reject
      // throws before saveDocumentImpl runs.
      const db = await getTestDb();
      const { discussionsTable } = await import("@/db/generated/collections");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select({ title: discussionsTable.title, status: discussionsTable.status })
        .from(discussionsTable)
        .where(eq(discussionsTable.id, docId))
        .limit(1)) as Array<{ title: string; status: string }>;
      expect(row.title).toBe("Clean");
      expect(row.status).toBe("published");
    });

    it("edit with clean content keeps the row published (#121)", async () => {
      // Sanity that the new moderation gate on update doesn't
      // demote a clean edit. Pre-fix the path skipped moderation
      // entirely; post-fix it runs but should still pass clean
      // text through to the original status.
      const core = await import("@nexpress/core");
      core.setSpamAdapter({
        check: (text) =>
          text.includes("badword") ? { kind: "flag" } : { kind: "pass" },
      });

      const member = await seedActiveMember("edit-clean");
      const create = await memberCreate(member, {
        title: "Clean original",
        slug: "edit-clean-1",
      });
      const docId = (await readJson<{ id: string }>(create)).body.id;

      const patch = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({ title: "Still clean" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(patch.status).toBe(200);
      const patched = await readJson<{ status: string }>(patch);
      expect(patched.body.status).toBe("published");
    });
  });
});

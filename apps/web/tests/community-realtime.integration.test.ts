import { npCommunityRealtimeEvents, npMembers, withCurrentSite } from "@nexpress/core";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import {
  npEmitCommunityDocumentChanged,
  npEmitCommunityInboxChanged,
  npListCommunityRealtimeEvents,
  npResolveCommunityRealtimeCursor,
  type NpCommunityRealtimeServerSubscription,
} from "@nexpress/core/community";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as engagementGET } from "@/app/api/engagement/route";
import { GET as realtimeGET } from "@/app/api/community/events/route";
import { postsTable } from "@/db/generated/collections";

import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./harness.js";

const TARGET_ID = "22222222-2222-4222-8222-222222222222";

describe.skipIf(skipIfNoTestDb())("community realtime outbox (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("isolates document and inbox streams by site, target, and member", async () => {
    const db = await getTestDb();
    const [member] = await db
      .insert(npMembers)
      .values({
        handle: "realtime-member",
        email: "realtime@example.com",
        displayName: "Realtime Member",
        status: "active",
      })
      .returning({ id: npMembers.id });
    if (!member) throw new Error("Failed to seed realtime member.");

    const documentA: NpCommunityRealtimeServerSubscription = {
      scope: "document",
      siteId: "default",
      targetType: "posts",
      targetId: TARGET_ID,
    };
    const documentB: NpCommunityRealtimeServerSubscription = {
      ...documentA,
      siteId: "realtime-b",
    };
    const inboxA: NpCommunityRealtimeServerSubscription = {
      scope: "inbox",
      siteId: "default",
      memberId: member.id,
    };
    const inboxB: NpCommunityRealtimeServerSubscription = {
      ...inboxA,
      siteId: "realtime-b",
    };
    const [documentCursorA, documentCursorB, inboxCursorA, inboxCursorB] = await Promise.all([
      npResolveCommunityRealtimeCursor(documentA, null),
      npResolveCommunityRealtimeCursor(documentB, null),
      npResolveCommunityRealtimeCursor(inboxA, null),
      npResolveCommunityRealtimeCursor(inboxB, null),
    ]);

    await withCurrentSite("default", async () => {
      await npEmitCommunityDocumentChanged("comments", "posts", TARGET_ID);
      await npEmitCommunityDocumentChanged("reactions", "posts", TARGET_ID);
      await npEmitCommunityInboxChanged(member.id);
    });
    await withCurrentSite("realtime-b", async () => {
      await npEmitCommunityDocumentChanged("comments", "posts", TARGET_ID);
      await npEmitCommunityInboxChanged(member.id);
    });

    const [pageA, pageB, privateA, privateB] = await Promise.all([
      npListCommunityRealtimeEvents(documentA, documentCursorA),
      npListCommunityRealtimeEvents(documentB, documentCursorB),
      npListCommunityRealtimeEvents(inboxA, inboxCursorA),
      npListCommunityRealtimeEvents(inboxB, inboxCursorB),
    ]);
    expect(pageA.events.map((event) => event.kind)).toEqual([
      "comments.changed",
      "reactions.changed",
    ]);
    expect(pageB.events.map((event) => event.kind)).toEqual(["comments.changed"]);
    expect(privateA.events.map((event) => event.kind)).toEqual(["notifications.changed"]);
    expect(privateB.events.map((event) => event.kind)).toEqual(["notifications.changed"]);
    expect(pageA.events[0]).toEqual({
      version: 1,
      id: expect.any(String),
      kind: "comments.changed",
      occurredAt: expect.any(String),
    });

    await withCurrentSite("default", () =>
      npEmitCommunityDocumentChanged("comments", "posts", TARGET_ID),
    );
    const resumed = await npListCommunityRealtimeEvents(documentA, pageA.cursor);
    expect(resumed.events.map((event) => event.kind)).toEqual(["comments.changed"]);

    const foreignCursor = await npResolveCommunityRealtimeCursor(inboxA, pageA.events[0]!.id);
    expect(foreignCursor.id).toBeNull();
    expect(foreignCursor.sequence).toBeGreaterThanOrEqual(privateA.cursor.sequence);
  });

  it("starts malformed and expired resume ids at the current scoped watermark", async () => {
    const subscription: NpCommunityRealtimeServerSubscription = {
      scope: "document",
      siteId: "default",
      targetType: "posts",
      targetId: TARGET_ID,
    };
    await withCurrentSite("default", () =>
      npEmitCommunityDocumentChanged("comments", "posts", TARGET_ID),
    );

    const malformed = await npResolveCommunityRealtimeCursor(subscription, "not-a-uuid");
    const [persisted] = await (
      await getTestDb()
    )
      .select()
      .from(npCommunityRealtimeEvents)
      .where(eq(npCommunityRealtimeEvents.siteId, "default"));
    if (!persisted) throw new Error("Realtime event was not persisted.");
    expect(malformed).toEqual({ id: null, sequence: persisted.sequence });
    expect((await npListCommunityRealtimeEvents(subscription, malformed)).events).toEqual([]);

    await withCurrentSite("default", () =>
      npEmitCommunityDocumentChanged("reactions", "posts", TARGET_ID),
    );
    const current = await npResolveCommunityRealtimeCursor(subscription, null);
    expect(current.sequence).toBeGreaterThan(persisted.sequence);
    await (
      await getTestDb()
    )
      .delete(npCommunityRealtimeEvents)
      .where(eq(npCommunityRealtimeEvents.id, persisted.id));

    const expired = await npResolveCommunityRealtimeCursor(subscription, persisted.id);
    expect(expired).toEqual({ id: null, sequence: current.sequence });
    expect((await npListCommunityRealtimeEvents(subscription, expired)).events).toEqual([]);
  });

  it("enforces channel and routing invariants in Postgres", async () => {
    const db = await getTestDb();
    await expect(
      db.insert(npCommunityRealtimeEvents).values({
        channel: "comments",
        siteId: "default",
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(npCommunityRealtimeEvents).values({
        channel: "unknown",
        targetType: "posts",
        targetId: TARGET_ID,
        siteId: "default",
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("fails closed before opening unauthorized or malformed streams", async () => {
    const inbox = await realtimeGET(
      new NextRequest("http://localhost:3000/api/community/events?scope=inbox"),
    );
    expect(inbox.status).toBe(401);

    const malformed = await realtimeGET(
      new NextRequest(
        "http://localhost:3000/api/community/events?scope=document&targetType=Posts&targetId=bad",
      ),
    );
    expect(malformed.status).toBe(400);

    const mixedInbox = await realtimeGET(
      new NextRequest(
        `http://localhost:3000/api/community/events?scope=inbox&targetType=posts&targetId=${TARGET_ID}`,
      ),
    );
    expect(mixedInbox.status).toBe(400);

    const engagement = await engagementGET(
      new NextRequest("http://localhost:3000/api/engagement?targetType=posts&targetId=bad"),
    );
    expect(engagement.status).toBe(400);
  });

  it("serves a readable document snapshot and a PII-free SSE frame", async () => {
    const [post] = await (
      await getTestDb()
    )
      .insert(postsTable)
      .values({
        title: "Realtime target",
        content: npCreateEmptyRichTextContent(),
        slug: "realtime-target",
        status: "published",
        publishedAt: new Date(),
        siteId: "default",
      })
      .returning({ id: postsTable.id });
    if (!post) throw new Error("Failed to seed realtime target.");

    const engagement = await engagementGET(
      new NextRequest(`http://localhost:3000/api/engagement?targetType=posts&targetId=${post.id}`),
    );
    expect(engagement.status).toBe(200);
    expect(engagement.headers.get("cache-control")).toBe("private, no-store");
    expect(await engagement.json()).toEqual({
      targetType: "posts",
      targetId: post.id,
      viewCount: 0,
      commentCount: 0,
      reactionCount: 0,
      reactions: {},
    });

    const abort = new AbortController();
    const response = await realtimeGET(
      new NextRequest(
        `http://localhost:3000/api/community/events?scope=document&targetType=posts&targetId=${post.id}`,
        { signal: abort.signal },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await withCurrentSite("default", () =>
      npEmitCommunityDocumentChanged("comments", "posts", post.id),
    );

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Realtime response did not include a body.");
    const decoder = new TextDecoder();
    let received = "";
    for (let index = 0; index < 4 && !received.includes("data: "); index += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value, { stream: true });
    }
    expect(received).toContain("retry: 3000");
    const data = received
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    if (!data) throw new Error("Realtime response did not include an event frame.");
    expect(JSON.parse(data)).toEqual({
      version: 1,
      id: expect.any(String),
      kind: "comments.changed",
      occurredAt: expect.any(String),
    });
    expect(received).not.toContain(post.id);

    await reader.cancel();
    abort.abort();
  });
});

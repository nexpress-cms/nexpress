import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import {
  POST as commentsPOST,
  GET as commentsGET,
} from "@/app/api/collections/[slug]/[id]/comments/route";

import { NextRequest } from "next/server";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

async function seedStaff(): Promise<{ token: string; csrf: string }> {
  const user = await seedUser({
    email: "staff@example.com",
    password: "password12345",
    name: "Staff",
    role: "editor",
  });
  return { token: user.accessToken, csrf: "csrf-staff" };
}

async function seedActiveMember(handle: string): Promise<{
  sessionCookie: string;
  csrfCookie: string;
}> {
  const session = await harnessSeedActiveMember({ handle });
  return {
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
  };
}

describe.skipIf(skipIfNoTestDb())(
  "forum (plugin-forum + discussions collection) integration",
  () => {
    beforeAll(async () => {
      await ensureMigrated();
      registerTestCollections();
      // Register the exact reference-app definition used to generate the table.
      const { discussionsCollection: config } = await import("@/collections/discussions");
      const { registerCollection } = await import("@nexpress/core");
      const { discussionsTable } = await import("@/db/generated/collections");
      // Strip the access policy so the synthetic test principal can write
      // (mirrors how `registerTestCollections` in core integration treats
      // posts).
      registerCollection("discussions", discussionsTable as never, {
        ...config,
        access: undefined,
        hooks: undefined,
      });
    });
    beforeEach(async () => {
      await truncateAll();
    });
    afterAll(async () => {
      await closeTestDb();
    });

    it("staff creates a discussion; member comments under it", async () => {
      const staff = await seedStaff();
      const member = await seedActiveMember("alice");

      const create = await collectionPOST(
        jsonRequest("/api/collections/discussions", {
          method: "POST",
          cookies: [`np-session=${staff.token}`, `np-csrf=${staff.csrf}`],
          headers: { "x-csrf-token": staff.csrf },
          body: JSON.stringify({
            title: "Welcome to the forum",
            slug: "welcome",
            body: npCreateEmptyRichTextContent(),
            category: "general",
            pinned: true,
            locked: false,
            _status: "published",
          }),
        }),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
      expect(create.status).toBe(201);
      const created = (await create.json()) as { id: string; pinned: boolean };
      expect(created.pinned).toBe(true);

      // Member comments under the discussion (proves community: { comments: true } is on).
      const reply = await commentsPOST(
        jsonRequest(`/api/collections/discussions/${created.id}/comments`, {
          method: "POST",
          cookies: [`np-mb-session=${member.sessionCookie}`, `np-mb-csrf=${member.csrfCookie}`],
          headers: { "x-csrf-token": member.csrfCookie },
          body: JSON.stringify({ bodyMd: "First reply, **excited** to be here." }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: created.id }) },
      );
      expect(reply.status).toBe(201);

      const list = await commentsGET(
        jsonRequest(`/api/collections/discussions/${created.id}/comments`),
        { params: Promise.resolve({ slug: "discussions", id: created.id }) },
      );
      const listBody = await readJson<{ totalDocs: number; comments: Array<{ bodyHtml: string }> }>(
        list,
      );
      expect(listBody.body.totalDocs).toBe(1);
      expect(listBody.body.comments[0]?.bodyHtml).toContain("<strong>excited</strong>");
    });

    // Phase 9.7a flipped this surface: members can now author
    // discussions thanks to `community.memberWrite.create` on the
    // forum plugin's collection. The dedicated coverage for member
    // creates lives in `member-discussions.integration.test.ts`;
    // this just sanity-checks the cookie path doesn't 401 anymore.
    it("accepts member-authored discussions (Phase 9.7a member-write)", async () => {
      const member = await seedActiveMember("bob");

      const create = await collectionPOST(
        jsonRequest("/api/collections/discussions", {
          method: "POST",
          cookies: [`np-mb-session=${member.sessionCookie}`, `np-mb-csrf=${member.csrfCookie}`],
          headers: { "x-csrf-token": member.csrfCookie },
          body: JSON.stringify({
            title: "Member-authored",
            slug: "by-member",
            body: npCreateEmptyRichTextContent(),
          }),
        }),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
      expect(create.status).toBe(201);
    });
  },
);

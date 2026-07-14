import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedActiveMember as harnessSeedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import {
  DELETE as collectionDELETE,
  PATCH as collectionPATCH,
} from "@/app/api/collections/[slug]/[id]/route";

import { NextRequest } from "next/server";

interface CapturedHookCall {
  hook: string;
  user: { id: string; email: string; role: string } | null;
  principalKind: "staff" | "member" | undefined;
  principalUserId?: string;
  principalMemberId?: string;
}

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  if (init.cookies && init.cookies.length > 0) {
    headers.set("cookie", init.cookies.join("; "));
  }
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function staffRequest(path: string, user: TestUserSession, init: RequestInit = {}): NextRequest {
  return jsonRequest(path, {
    ...init,
    cookies: [`np-session=${user.accessToken}`, `np-csrf=${user.csrfToken}`],
    headers: { ...(init.headers ?? {}), "x-csrf-token": user.csrfToken },
  });
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

describe.skipIf(skipIfNoTestDb())("hook polymorphism (Phase 9.7o)", () => {
  const captured: CapturedHookCall[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    // Register `discussions` with a config that wires `beforeCreate`
    // / `beforeDelete` collection hooks. Hooks capture the principal
    // shape so the test can assert on it. Discussions opt into
    // `community.memberWrite.{create,delete}`, so both staff and
    // member writes hit the same hook list — exactly the shared
    // path 9.7o is widening.
    const { defineDiscussionsCollection } = await import("@nexpress/plugin-forum");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    const baseConfig = defineDiscussionsCollection();
    const hooked = {
      ...baseConfig,
      access: undefined,
      hooks: {
        beforeCreate: [
          (
            args: Parameters<
              NonNullable<typeof baseConfig.hooks>["beforeCreate"]
            >[0] extends infer T
              ? T
              : never,
          ) => {
            const { user, principal } = args as unknown as {
              user: { id: string; email: string; role: string } | null;
              principal:
                { kind: "staff"; user: { id: string } } | { kind: "member"; memberId: string };
            };
            captured.push({
              hook: "beforeCreate",
              user,
              principalKind: principal?.kind,
              principalUserId: principal?.kind === "staff" ? principal.user.id : undefined,
              principalMemberId: principal?.kind === "member" ? principal.memberId : undefined,
            });
            return (args as unknown as { data: Record<string, unknown> }).data;
          },
        ],
        beforeDelete: [
          (args: unknown) => {
            const { user, principal } = args as {
              user: { id: string; email: string; role: string } | null;
              principal:
                { kind: "staff"; user: { id: string } } | { kind: "member"; memberId: string };
            };
            captured.push({
              hook: "beforeDelete",
              user,
              principalKind: principal?.kind,
              principalUserId: principal?.kind === "staff" ? principal.user.id : undefined,
              principalMemberId: principal?.kind === "member" ? principal.memberId : undefined,
            });
            return (args as { data: Record<string, unknown> }).data;
          },
        ],
      },
    } as Parameters<typeof registerCollection>[2];
    registerCollection("discussions", discussionsTable as never, hooked);
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
    // Re-register after the read bootstrap runs nexpressConfig.collections,
    // otherwise the hooks would be overwritten. Same dance the cascade
    // tests do.
    registerCollection("discussions", discussionsTable as never, hooked);
  });

  beforeEach(async () => {
    await truncateAll();
    captured.length = 0;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("staff create fires beforeCreate with principal.kind='staff' and resolved user", async () => {
    const editor = await seedUser({ role: "editor" });

    const create = await collectionPOST(
      staffRequest("/api/collections/discussions", editor, {
        method: "POST",
        body: JSON.stringify({
          title: "Staff thread",
          slug: "staff-thread",
          body: npCreateEmptyRichTextContent(),
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    expect(create.status).toBe(201);

    const calls = captured.filter((c) => c.hook === "beforeCreate");
    expect(calls).toHaveLength(1);
    expect(calls[0].principalKind).toBe("staff");
    expect(calls[0].principalUserId).toBe(editor.userId);
    expect(calls[0].user?.id).toBe(editor.userId);
  });

  it("member create fires beforeCreate with principal.kind='member' and user=null", async () => {
    // Pre-9.7o this hook was SKIPPED for member writes — the test
    // would have observed an empty `captured` array. The widened
    // signature now passes `principal: { kind: "member", memberId }`
    // and `user: null`, so plugins can react to member-authored
    // creates without a separate event.
    const member = await seedActiveMember("hook-member");

    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Member thread",
          slug: "member-thread",
          body: npCreateEmptyRichTextContent(),
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    expect(create.status).toBe(201);

    const calls = captured.filter((c) => c.hook === "beforeCreate");
    expect(calls).toHaveLength(1);
    expect(calls[0].principalKind).toBe("member");
    expect(calls[0].principalMemberId).toBe(member.memberId);
    expect(calls[0].user).toBeNull();
  });

  it("member delete fires beforeDelete with principal.kind='member'", async () => {
    const member = await seedActiveMember("hook-member-del");

    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Doomed thread",
          slug: "doomed",
          body: npCreateEmptyRichTextContent(),
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const { id: docId } = await readJson<{ id: string }>(create).then((r) => r.body);
    captured.length = 0; // discard the create's beforeCreate

    const del = await collectionDELETE(
      memberRequest(`/api/collections/discussions/${docId}`, member, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(del.status).toBe(204);

    const calls = captured.filter((c) => c.hook === "beforeDelete");
    expect(calls).toHaveLength(1);
    expect(calls[0].principalKind).toBe("member");
    expect(calls[0].principalMemberId).toBe(member.memberId);
    expect(calls[0].user).toBeNull();
  });

  it("plugin content hooks receive the canonical principal for member writes", async () => {
    // Plugin-side hook: the `runHook("content:afterCreate", ...)`
    // payload that fires after every save carries one canonical `principal`
    // so plugins can react polymorphically. Loaded via the public
    // `loadPlugins()` API (no test-only registration helper needed).
    const seen: Array<{
      hook: "content:afterCreate" | "content:afterUpdate";
      principal: unknown;
      documentId: string;
      source: string;
      marker: unknown;
    }> = [];
    const { loadPlugins } = await import("@nexpress/core/bootstrap");
    const { definePlugin } = await import("@nexpress/plugin-sdk");
    await loadPlugins([
      definePlugin({
        manifest: {
          id: "test-hook-polymorphism",
          version: "0.0.0",
          name: "Hook polymorphism test plugin",
          description: "captures principal payload on member writes",
          author: { name: "Test" },
          license: "MIT",
          nexpress: { minVersion: "0.1.0" },
          capabilities: ["hooks:content"],
          allowedHosts: [],
          provides: {
            blocks: [],
            collections: [],
            adminExtensions: [],
            apiRoutes: [],
            hooks: ["content:afterCreate"],
          },
          agent: { description: "test", category: "content", tags: [] },
          usesTokens: [],
          styleSlots: {},
        },
        hooks: {
          "content:beforeCreate": ({ data }) => {
            if (data.collection === "discussions" && data.document.title === "Plugin-observed") {
              data.document.title = "Plugin-observed by hook";
            }
          },
          "content:afterCreate": ({ data }) => {
            if (
              data.collection !== "discussions" ||
              data.document.title !== "Plugin-observed by hook"
            ) {
              return;
            }
            seen.push({
              hook: "content:afterCreate",
              principal: data.principal,
              documentId: data.documentId,
              source: data.source,
              marker: data.document.title,
            });
          },
          "content:beforeUpdate": ({ data }) => {
            if (data.collection === "discussions" && data.document.title === "Plugin-updated") {
              data.document.title = "Plugin-updated by hook";
            }
          },
          "content:afterUpdate": ({ data }) => {
            if (
              data.collection !== "discussions" ||
              data.document.title !== "Plugin-updated by hook"
            ) {
              return;
            }
            seen.push({
              hook: "content:afterUpdate",
              principal: data.principal,
              documentId: data.documentId,
              source: data.source,
              marker: data.document.title,
            });
          },
        },
      }),
    ]);

    const member = await seedActiveMember("hook-plugin");

    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Plugin-observed",
          slug: "plugin-observed",
          body: npCreateEmptyRichTextContent(),
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const created = await readJson<{ id: string; title: string }>(create);
    expect(created.body.title).toBe("Plugin-observed by hook");

    expect(seen.length).toBeGreaterThanOrEqual(1);
    const memberCall = seen.find(
      (s) =>
        s.hook === "content:afterCreate" &&
        (s.principal as { kind?: string } | undefined)?.kind === "member",
    );
    expect(memberCall).toBeDefined();
    expect(memberCall?.source).toBe("request");
    expect(memberCall?.documentId).toEqual(expect.any(String));
    expect(memberCall?.marker).toBe("Plugin-observed by hook");
    const principal = memberCall?.principal as {
      kind: "member";
      memberId: string;
    };
    expect(principal.memberId).toBe(member.memberId);

    const update = await collectionPATCH(
      memberRequest(`/api/collections/discussions/${created.body.id}`, member, {
        method: "PATCH",
        body: JSON.stringify({ title: "Plugin-updated", slug: "plugin-observed" }),
      }),
      { params: Promise.resolve({ slug: "discussions", id: created.body.id }) },
    );
    const updated = await readJson<{ title: string }>(update);
    expect(updated.body.title).toBe("Plugin-updated by hook");
    expect(
      seen.find(
        (call) => call.hook === "content:afterUpdate" && call.documentId === created.body.id,
      )?.marker,
    ).toBe("Plugin-updated by hook");
  });
});

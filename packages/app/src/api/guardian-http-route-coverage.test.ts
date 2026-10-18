import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { NpAgentGuardianHttpObservationServiceV1 } from "@nexpress/core/agents";

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  observe: vi.fn<NpAgentGuardianHttpObservationServiceV1["observe"]>(),
  ensureFor: vi.fn(),
  resolveRequest: vi.fn(),
  optionalAuth: vi.fn(),
  optionalMember: vi.fn(),
  requireAuth: vi.fn(),
  requireMember: vi.fn(),
}));
vi.mock("@nexpress/core", async (original) => ({
  ...(await original<object>()),
  can: () => false,
}));
vi.mock("@nexpress/core/agents", () => ({ getOptionalAgentStudioServerRuntimeV1: mocks.runtime }));
vi.mock("../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));
vi.mock("../lib/agents/guardian-request-observer", () => ({
  resolveAuthRequestContext: mocks.resolveRequest,
}));
vi.mock("../lib/auth-helpers", () => ({
  optionalAuth: mocks.optionalAuth,
  requireAuth: mocks.requireAuth,
}));
vi.mock("../lib/member-auth-helpers", () => ({
  optionalMember: mocks.optionalMember,
  requireMember: mocks.requireMember,
}));
vi.mock("../lib/collection-helpers", () => ({
  extractSaveOptions: vi.fn(),
  findCollectionDocuments: vi.fn(),
  parseBodyRecord: vi.fn(),
  parseFindOptions: vi.fn(),
  npSerializeCollectionDocumentForApi: vi.fn(),
  saveCollectionDocument: vi.fn(),
}));
vi.mock("../lib/revalidate", () => ({ revalidateCollection: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: vi.fn() }));

import { NpAuthError } from "@nexpress/core";
import { POST as collectionCreate } from "./collections/[slug]/route.js";
import { POST as mediaUpload } from "./media/upload/route.js";
import { GET as mediaDownload } from "./media/attachments/[id]/route.js";
import { POST as pluginAction } from "./plugins/[pluginId]/actions/[actionId]/route.js";
import { GET as communityPreferences } from "./members/me/notification-prefs/route.js";

const request = (path: string, method = "GET") =>
  new NextRequest(`https://example.test${path}`, {
    method,
    headers: { "x-forwarded-for": "192.0.2.81" },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockReturnValue({ guardianHttp: { observe: mocks.observe } });
  mocks.observe.mockResolvedValue({ disposition: "recorded", eventId: "event", incidentId: null });
  mocks.ensureFor.mockResolvedValue(undefined);
  mocks.resolveRequest.mockResolvedValue({ siteId: "default", networkAddress: "192.0.2.81" });
  mocks.optionalAuth.mockResolvedValue(null);
  mocks.optionalMember.mockResolvedValue(null);
  mocks.requireAuth.mockResolvedValue({ id: "staff", role: "author" });
  mocks.requireMember.mockRejectedValue(new NpAuthError());
});

describe("CMS and community actual route final responses", () => {
  it("observes the collection owner's actual 401 without changing its safe error", async () => {
    const response = await collectionCreate(request("/api/collections/posts", "POST"), {
      params: Promise.resolve({ slug: "posts" }),
    });
    expect(response.status).toBe(401);
    expect(response.bodyUsed).toBe(false);
    expect(mocks.observe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 401, routeFamily: "collections", siteId: "default" }),
    );
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("preserves actual upload and plugin dispatcher denials with their distinct static families", async () => {
    const upload = await mediaUpload(request("/api/media/upload", "POST"));
    const plugin = await pluginAction(request("/api/plugins/private/actions/private", "POST"), {
      params: Promise.resolve({ pluginId: "private", actionId: "private" }),
    });
    expect(upload.status).toBe(403);
    expect(plugin.status).toBe(403);
    expect(mocks.observe.mock.calls.map(([input]) => [input.status, input.routeFamily])).toEqual([
      [403, "media-upload"],
      [403, "plugins"],
    ]);
    expect(JSON.stringify(mocks.observe.mock.calls)).not.toContain("private");
    expect(upload.bodyUsed).toBe(false);
    expect(plugin.bodyUsed).toBe(false);
  });

  it("records the deliberate CMS attachment 404 and member community 401 as observations", async () => {
    const attachment = await mediaDownload(request("/api/media/attachments/invalid"), {
      params: Promise.resolve({ id: "invalid" }),
    });
    const member = await communityPreferences(request("/api/members/me/notification-prefs"));
    expect(attachment.status).toBe(404);
    expect(member.status).toBe(401);
    expect(mocks.observe.mock.calls.map(([input]) => [input.status, input.routeFamily])).toEqual([
      [404, "cms"],
      [401, "community"],
    ]);
    expect(attachment.bodyUsed).toBe(false);
    expect(member.bodyUsed).toBe(false);
  });
});

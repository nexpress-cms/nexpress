import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 15.8 — pin the user-search endpoint that the
 * memberships grant dialog depends on. The endpoint itself
 * pre-existed (used by the admin user list); these tests
 * lock the search filter behavior + role gate so the picker
 * UI stays wired correctly.
 */
describe.skipIf(skipIfNoTestDb())("user search for memberships picker (Phase 15.8)", () => {
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

  it("/api/users?search=email returns matching users (editor+)", async () => {
    const editor = await seedUser({ role: "editor" });
    await seedUser({
      role: "viewer",
      email: "alice.target@example.com",
      name: "Alice Target",
    });
    await seedUser({
      role: "viewer",
      email: "bob.other@example.com",
      name: "Bob Other",
    });

    const { GET } = await import("@/app/api/users/route");
    const req = buildRequest("/api/users", {
      session: editor,
      query: { search: "alice" },
    });
    const res = await GET(req);
    const { status, body } = await readJson<{
      docs?: Array<{ email: string; name: string }>;
    }>(res);
    expect(status).toBe(200);
    expect(body.docs?.some((d) => d.email === "alice.target@example.com")).toBe(true);
    expect(body.docs?.some((d) => d.email === "bob.other@example.com")).toBe(false);
  });

  it("/api/users?search= matches by name fragment too (case-insensitive)", async () => {
    const editor = await seedUser({ role: "editor" });
    await seedUser({
      role: "viewer",
      email: "x@example.com",
      name: "Carmen Sandiego",
    });

    const { GET } = await import("@/app/api/users/route");
    const req = buildRequest("/api/users", {
      session: editor,
      query: { search: "SANDIEGO" },
    });
    const res = await GET(req);
    const { body } = await readJson<{ docs?: Array<{ name: string }> }>(res);
    expect(body.docs?.some((d) => d.name === "Carmen Sandiego")).toBe(true);
  });

  it("/api/users forbids viewers (the picker should never load for non-staff)", async () => {
    const viewer = await seedUser({ role: "viewer" });
    const { GET } = await import("@/app/api/users/route");
    const req = buildRequest("/api/users", { session: viewer });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });
});

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

  it("/api/users searches by email and case-insensitive name for editors and forbids viewers", async () => {
    const editor = await seedUser({ role: "editor", email: "editor@example.com" });
    await seedUser({
      role: "viewer",
      email: "alice.target@example.com",
      name: "Email Match",
    });
    const viewer = await seedUser({
      role: "viewer",
      email: "bob.other@example.com",
      name: "Bob Other",
    });
    await seedUser({
      role: "viewer",
      email: "x@example.com",
      name: "Carmen Sandiego",
    });

    const { GET } = await import("@/app/api/users/route");
    const emailSearch = await GET(
      buildRequest("/api/users", { session: editor, query: { search: "alice" } }),
    );
    const emailMatches = await readJson<{ docs?: Array<{ email: string }> }>(emailSearch);
    expect.soft(emailMatches.status, "email search").toBe(200);
    expect
      .soft(emailMatches.body.docs?.map((doc) => doc.email))
      .toEqual(["alice.target@example.com"]);

    const nameSearch = await GET(
      buildRequest("/api/users", { session: editor, query: { search: "SANDIEGO" } }),
    );
    const nameMatches = await readJson<{ docs?: Array<{ name: string }> }>(nameSearch);
    expect.soft(nameMatches.status, "case-insensitive name search").toBe(200);
    expect.soft(nameMatches.body.docs?.map((doc) => doc.name)).toEqual(["Carmen Sandiego"]);

    const forbidden = await GET(buildRequest("/api/users", { session: viewer }));
    const { status } = await readJson(forbidden);
    expect(status).toBe(403);
  });
});

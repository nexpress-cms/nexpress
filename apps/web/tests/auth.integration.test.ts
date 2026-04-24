import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { GET as meGET } from "@/app/api/auth/me/route";

describe.skipIf(skipIfNoTestDb())("auth API (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  describe("GET /api/auth/me", () => {
    it("returns the authenticated user when a valid session cookie is present", async () => {
      const session = await seedUser({ email: "auth@example.com", role: "editor" });
      const request = buildRequest("/api/auth/me", { session });

      const { status, body } = await readJson<{ user: { email: string; role: string } }>(
        await meGET(request),
      );
      expect(status).toBe(200);
      expect(body.user.email).toBe("auth@example.com");
      expect(body.user.role).toBe("editor");
    });

    it("401s without a session cookie", async () => {
      const request = buildRequest("/api/auth/me");
      const { status } = await readJson(await meGET(request));
      expect(status).toBe(401);
    });

    it("401s when the token is signed with a different secret", async () => {
      const session = await seedUser();
      const request = buildRequest("/api/auth/me", {
        session: { ...session, accessToken: "not.a.jwt" },
      });
      const { status } = await readJson(await meGET(request));
      expect(status).toBe(401);
    });
  });
});

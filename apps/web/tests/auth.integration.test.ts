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
import { POST as refreshPOST } from "@/app/api/auth/refresh/route";

import { NextRequest } from "next/server";

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

    // Regression for #94: a staff refresh JWT must NOT be accepted in
    // the session cookie. Before the fix `signToken` minted identical
    // shapes for access and refresh, so a 7-day refresh could be
    // smuggled into `nx-session` and bought a 7-day admin bearer.
    it("401s when a refresh JWT is used as the session cookie", async () => {
      const { signToken } = await import("@nexpress/core");
      const session = await seedUser({ email: "ref@example.com", role: "admin" });
      const refreshToken = await signToken(
        {
          id: session.userId,
          role: session.role,
          tokenVersion: 0,
        },
        process.env.NP_SECRET as string,
        7200,
        "refresh",
      );
      const request = buildRequest("/api/auth/me", {
        session: { ...session, accessToken: refreshToken },
      });
      const { status } = await readJson(await meGET(request));
      expect(status).toBe(401);
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("rotates with a valid refresh JWT", async () => {
      const { signToken } = await import("@nexpress/core");
      const session = await seedUser({ email: "rot@example.com", role: "editor" });
      const refresh = await signToken(
        { id: session.userId, role: session.role, tokenVersion: 0 },
        process.env.NP_SECRET as string,
        604800,
        "refresh",
      );
      const req = new NextRequest("http://localhost:3000/api/auth/refresh", {
        method: "POST",
        headers: { cookie: `nx-refresh=${refresh}` },
      });
      const res = await refreshPOST(req);
      expect(res.status).toBe(200);
    });

    // Regression for #94: an access JWT presented to the rotation
    // endpoint must be refused. Otherwise a stolen short-lived
    // session cookie could be self-rotated into a fresh refresh
    // pair, defeating the access/refresh separation.
    it("401s when an access JWT is presented as the refresh cookie", async () => {
      const { signToken } = await import("@nexpress/core");
      const session = await seedUser({ email: "rot2@example.com", role: "editor" });
      const access = await signToken(
        { id: session.userId, role: session.role, tokenVersion: 0 },
        process.env.NP_SECRET as string,
        7200,
        "access",
      );
      const req = new NextRequest("http://localhost:3000/api/auth/refresh", {
        method: "POST",
        headers: { cookie: `nx-refresh=${access}` },
      });
      const res = await refreshPOST(req);
      expect(res.status).toBe(401);
    });
  });
});

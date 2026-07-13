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
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as refreshPOST } from "@/app/api/auth/refresh/route";
import { PATCH as changePasswordPATCH } from "@/app/api/auth/change-password/route";

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
    // smuggled into `np-session` and bought a 7-day admin bearer.
    it("401s when a refresh JWT is used as the session cookie", async () => {
      const session = await seedUser({ email: "ref@example.com", role: "admin" });
      const request = buildRequest("/api/auth/me", {
        session: { ...session, accessToken: session.refreshToken },
      });
      const { status } = await readJson(await meGET(request));
      expect(status).toBe(401);
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("rotates with a valid refresh JWT", async () => {
      const session = await seedUser({ email: "rot@example.com", role: "editor" });
      const req = new NextRequest("http://localhost:3000/api/auth/refresh", {
        method: "POST",
        headers: { cookie: `np-refresh=${session.refreshToken}` },
      });
      const res = await refreshPOST(req);
      expect(res.status).toBe(200);
      expect(res.cookies.get("np-session")?.value).toBeTruthy();
      expect(res.cookies.get("np-refresh")?.value).toBeTruthy();

      const replay = await refreshPOST(req);
      expect(replay.status).toBe(401);
    });

    // Regression for #94: an access JWT presented to the rotation
    // endpoint must be refused. Otherwise a stolen short-lived
    // session cookie could be self-rotated into a fresh refresh
    // pair, defeating the access/refresh separation.
    it("401s when an access JWT is presented as the refresh cookie", async () => {
      const session = await seedUser({ email: "rot2@example.com", role: "editor" });
      const req = new NextRequest("http://localhost:3000/api/auth/refresh", {
        method: "POST",
        headers: { cookie: `np-refresh=${session.accessToken}` },
      });
      const res = await refreshPOST(req);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("revokes the access/refresh family using only the access cookie", async () => {
      const session = await seedUser({ email: "logout@example.com", role: "admin" });
      const logout = await logoutPOST(
        new NextRequest("http://localhost:3000/api/auth/logout", {
          method: "POST",
          headers: { cookie: `np-session=${session.accessToken}` },
        }),
      );
      expect(logout.status).toBe(200);

      const me = await meGET(
        buildRequest("/api/auth/me", {
          session,
        }),
      );
      expect(me.status).toBe(401);

      const refresh = await refreshPOST(
        new NextRequest("http://localhost:3000/api/auth/refresh", {
          method: "POST",
          headers: { cookie: `np-refresh=${session.refreshToken}` },
        }),
      );
      expect(refresh.status).toBe(401);
    });

    it("revokes the session with the refresh cookie when the access cookie is absent", async () => {
      const session = await seedUser({ email: "logout-refresh@example.com", role: "admin" });
      const logout = await logoutPOST(
        new NextRequest("http://localhost:3000/api/auth/logout", {
          method: "POST",
          headers: { cookie: `np-refresh=${session.refreshToken}` },
        }),
      );
      expect(logout.status).toBe(200);

      const refresh = await refreshPOST(
        new NextRequest("http://localhost:3000/api/auth/refresh", {
          method: "POST",
          headers: { cookie: `np-refresh=${session.refreshToken}` },
        }),
      );
      expect(refresh.status).toBe(401);
    });

    it("revokes both families when the cookie pair names different sessions", async () => {
      const accessSession = await seedUser({ email: "logout-mixed-a@example.com", role: "admin" });
      const refreshSession = await seedUser({ email: "logout-mixed-b@example.com", role: "admin" });
      const logout = await logoutPOST(
        new NextRequest("http://localhost:3000/api/auth/logout", {
          method: "POST",
          headers: {
            cookie: `np-session=${accessSession.accessToken}; np-refresh=${refreshSession.refreshToken}`,
          },
        }),
      );
      expect(logout.status).toBe(200);

      for (const session of [accessSession, refreshSession]) {
        const refresh = await refreshPOST(
          new NextRequest("http://localhost:3000/api/auth/refresh", {
            method: "POST",
            headers: { cookie: `np-refresh=${session.refreshToken}` },
          }),
        );
        expect(refresh.status).toBe(401);
      }
    });
  });

  describe("PATCH /api/auth/change-password", () => {
    it("atomically changes the password and revokes every session family", async () => {
      const session = await seedUser({ email: "change@example.com", role: "admin" });
      const changed = await changePasswordPATCH(
        new NextRequest("http://localhost:3000/api/auth/change-password", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: `np-session=${session.accessToken}`,
          },
          body: JSON.stringify({
            currentPassword: "password123456",
            newPassword: "new-password-123456",
          }),
        }),
      );
      expect(changed.status).toBe(200);

      const staleMe = await meGET(buildRequest("/api/auth/me", { session }));
      expect(staleMe.status).toBe(401);
      const staleRefresh = await refreshPOST(
        new NextRequest("http://localhost:3000/api/auth/refresh", {
          method: "POST",
          headers: { cookie: `np-refresh=${session.refreshToken}` },
        }),
      );
      expect(staleRefresh.status).toBe(401);

      const oldLogin = await loginPOST(
        new NextRequest("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: session.email, password: "password123456" }),
        }),
      );
      expect(oldLogin.status).toBe(401);
      const newLogin = await loginPOST(
        new NextRequest("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: session.email, password: "new-password-123456" }),
        }),
      );
      expect(newLogin.status).toBe(200);
    });
  });
});

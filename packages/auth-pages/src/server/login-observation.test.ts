import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ verify: vi.fn(), session: vi.fn(), hook: vi.fn() }));
vi.mock("@nexpress/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifyPassword: auth.verify,
  createStaffSession: auth.session,
  createMemberSession: auth.session,
}));
vi.mock("@nexpress/core/bootstrap", () => ({ runHook: auth.hook }));

import { createStaffAuthRoutes } from "./staff-factory.js";
import { createMemberAuthRoutes } from "./factory.js";

const id = "00000000-0000-4000-8000-000000000001";
const runtime = {
  secret: "synthetic-observation-test-secret",
  maxLoginAttempts: 5,
  lockoutDuration: 60,
  tokenExpiration: 3600,
  refreshTokenExpiration: 86_400,
  secureCookies: true,
};
const user = () => ({
  id,
  email: "person@example.test",
  password: "stored-hash",
  name: "Person",
  role: "admin",
  handle: "person",
  displayName: "Person",
  status: "active",
  tokenVersion: 1,
  loginAttempts: 0,
  lockUntil: null as Date | null,
});
const req = (body: unknown) =>
  new NextRequest("https://example.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
function setup(audience: "staff" | "member") {
  let rows: Array<ReturnType<typeof user>> = [];
  const query = vi.fn().mockImplementation(() => Promise.resolve({ rows }));
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  }));
  const update = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
  const ensureFor = vi.fn().mockResolvedValue(undefined);
  const onLoginFailure = vi.fn().mockResolvedValue(undefined);
  const cookies = vi.fn();
  const base = {
    getDb: () => ({ $client: { query }, select, update }),
    ensureFor,
    onLoginFailure,
    site: { name: "Test" },
  };
  const route =
    audience === "staff"
      ? createStaffAuthRoutes({
          ...base,
          authHelpers: {
            setAuthCookies: cookies,
            clearAuthCookies: vi.fn(),
            getAuthRuntimeConfig: () => runtime,
            requireAuth: vi.fn(),
            optionalAuth: vi.fn(),
            revokeCurrentAuthSession: vi.fn(),
          },
        })
      : createMemberAuthRoutes({
          ...base,
          authHelpers: {
            setMemberAuthCookies: cookies,
            clearMemberAuthCookies: vi.fn(),
            getMemberAuthRuntimeConfig: () => runtime,
            requireMember: vi.fn(),
            revokeCurrentMemberSession: vi.fn(),
          },
        });
  return {
    route,
    query,
    select,
    update,
    onLoginFailure,
    ensureFor,
    cookies,
    setRows: (next: typeof rows) => {
      rows = next;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.verify.mockResolvedValue(false);
  auth.session.mockResolvedValue({ access: "access", refresh: "refresh" });
  auth.hook.mockResolvedValue(undefined);
});
for (const audience of ["staff", "member"] as const) {
  describe(`${audience} login observation`, () => {
    it("observes actual credential rejections once with a normalized identifier and no password", async () => {
      const state = setup(audience);
      const request = req({ email: " Person@Example.Test ", password: "private-candidate" });
      const response = await state.route.login(request);
      expect(response.status).toBe(401);
      expect(state.onLoginFailure).toHaveBeenCalledExactlyOnceWith({
        request,
        audience,
        loginIdentifier: "person@example.test",
      });
      expect(Object.keys(state.onLoginFailure.mock.calls[0][0]).sort()).toEqual([
        "audience",
        "loginIdentifier",
        "request",
      ]);
      expect(request.bodyUsed).toBe(true);
      expect(auth.verify).not.toHaveBeenCalled();
      expect(state.cookies).not.toHaveBeenCalled();
      expect(state.ensureFor).toHaveBeenCalledExactlyOnceWith("write");
    });

    it("preserves wrong-password lockout writes and the response when the observer fails", async () => {
      const state = setup(audience);
      state.setRows([user()]);
      state.onLoginFailure.mockRejectedValue(new Error("collector unavailable"));
      const response = await state.route.login(
        req({ email: "person@example.test", password: "private-candidate" }),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "UNAUTHORIZED",
          message: audience === "staff" ? "Invalid email or password" : "Invalid credentials",
        },
        status: 401,
      });
      expect(state.onLoginFailure).toHaveBeenCalledOnce();
      expect(auth.verify).toHaveBeenCalledExactlyOnceWith("stored-hash", "private-candidate");
      if (audience === "staff") {
        expect(state.query).toHaveBeenCalledTimes(2);
        expect(state.query.mock.calls[1][0]).toContain("login_attempts = login_attempts + 1");
      } else expect(state.update).toHaveBeenCalledOnce();
      expect(auth.session).not.toHaveBeenCalled();
    });

    it("records the existing lockout result without password verification or a second write", async () => {
      const state = setup(audience);
      state.setRows([{ ...user(), lockUntil: new Date(Date.now() + 60_000) }]);
      state.onLoginFailure.mockRejectedValue(new Error("collector unavailable"));
      const response = await state.route.login(
        req({ email: "person@example.test", password: "private-candidate" }),
      );
      expect(response.status).toBe(audience === "staff" ? 429 : 401);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: audience === "staff" ? "TOO_MANY_REQUESTS" : "UNAUTHORIZED",
          message:
            audience === "staff" ? "Too many login attempts" : "Account is temporarily locked",
        },
        status: audience === "staff" ? 429 : 401,
      });
      expect(state.onLoginFailure).toHaveBeenCalledOnce();
      expect(auth.verify).not.toHaveBeenCalled();
      expect(state.update).not.toHaveBeenCalled();
      if (audience === "staff") expect(state.query).toHaveBeenCalledOnce();
    });

    it("excludes invalid input, bootstrap/database failures and successful login", async () => {
      const state = setup(audience);
      expect(
        (await state.route.login(req({ email: "invalid", password: "private-candidate" }))).status,
      ).toBe(400);
      expect(state.onLoginFailure).not.toHaveBeenCalled();
      state.ensureFor.mockRejectedValueOnce(new Error("bootstrap unavailable"));
      expect(
        (
          await state.route.login(
            req({ email: "person@example.test", password: "private-candidate" }),
          )
        ).status,
      ).toBe(500);
      expect(state.onLoginFailure).not.toHaveBeenCalled();
      if (audience === "staff") state.query.mockRejectedValueOnce(new Error("DB unavailable"));
      else
        state.select.mockImplementationOnce(() => {
          throw new Error("DB unavailable");
        });
      expect(
        (
          await state.route.login(
            req({ email: "person@example.test", password: "private-candidate" }),
          )
        ).status,
      ).toBe(500);
      expect(state.onLoginFailure).not.toHaveBeenCalled();
      state.setRows([user()]);
      auth.verify.mockResolvedValueOnce(true);
      expect(
        (
          await state.route.login(
            req({ email: "person@example.test", password: "private-candidate" }),
          )
        ).status,
      ).toBe(200);
      expect(state.onLoginFailure).not.toHaveBeenCalled();
      expect(state.cookies).toHaveBeenCalledOnce();
      expect(auth.session).toHaveBeenCalledOnce();
    });
  });
}

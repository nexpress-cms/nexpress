import {
  NpAuthError,
  NpError,
  NpValidationError,
  consumePasswordResetToken,
  enqueueJob,
  getLogger,
  getOAuthProvider,
  hashPassword,
  invalidateAllSessions,
  issueOAuthState,
  requestPasswordReset,
  resolveOAuthLogin,
  runHook,
  signToken,
  verifyOAuthState,
  verifyPassword,
  verifyTokenFull,
  type NpUserRole,
} from "@nexpress/core";
import { npErrorResponse, npSuccessResponse, readJsonBody } from "@nexpress/next";
import { NextResponse, type NextRequest } from "next/server";

import type {
  StaffAuthRoutes,
  StaffAuthRoutesConfig,
  StaffAuthRoutesOptions,
} from "./staff-types.js";

const STATE_COOKIE = "np-oauth-state";
const STATE_COOKIE_MAX_AGE = 600;

const DEFAULTS = {
  resetPassword: { minPasswordLength: 8 },
  changePassword: { minPasswordLength: 8 },
  forgotPassword: { tokenTtlMs: 60 * 60_000 },
  oauth: { successRedirect: "/admin", failureRedirect: "/admin/login" },
  resetUrlPath: "/admin/set-password",
} as const;

function resolved(o: StaffAuthRoutesOptions = {}) {
  return {
    resetPassword: { ...DEFAULTS.resetPassword, ...o.resetPassword },
    changePassword: { ...DEFAULTS.changePassword, ...o.changePassword },
    forgotPassword: { ...DEFAULTS.forgotPassword, ...o.forgotPassword },
    oauth: { ...DEFAULTS.oauth, ...o.oauth },
    resetUrlPath: o.resetUrlPath ?? DEFAULTS.resetUrlPath,
  };
}

function siteUrl(config: StaffAuthRoutesConfig, request: NextRequest): URL {
  return config.site.url ? new URL(config.site.url) : new URL(request.url);
}

interface LoginUserRow {
  id: string;
  email: string;
  password: string;
  name: string;
  role: NpUserRole;
  loginAttempts: number;
  lockUntil: Date | null;
  tokenVersion: number;
}

interface PasswordRow {
  password: string;
}

/**
 * Minimal `db.$client.query` shape — staff routes use raw SQL
 * (the legacy code path predates Drizzle integration on this
 * surface). Typed loosely so consumers' Drizzle handle
 * (`NodePgDatabase<schema>`) plugs in without import gymnastics.
 */
type RawQueryDb = {
  $client: {
    query: <T>(sql: string, params: unknown[]) => Promise<{ rows: T[] }>;
  };
};

function asRawDb(handle: unknown): RawQueryDb {
  return handle as RawQueryDb;
}

/**
 * Bootstrap factory for staff auth routes. Mirror of
 * `createMemberAuthRoutes` for the staff (admin) user pool —
 * different DB table (`np_users`), different cookie names, no
 * registration / email-verify flow (staff are admin-provisioned),
 * plus a `changePassword` endpoint for the authenticated-user
 * flow that member's `/me` PATCH covers.
 *
 * Typical placement: `apps/<app>/src/lib/auth-routes.ts`
 * alongside the member-auth bootstrap. Each
 * `app/api/auth/<flow>/route.ts` re-exports the matching property.
 */
export function createStaffAuthRoutes(config: StaffAuthRoutesConfig): StaffAuthRoutes {
  const opts = resolved(config.options);
  const { getDb, ensureFor, authHelpers } = config;

  // ─── login ──────────────────────────────────────────────────
  const login = async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { email, password } = validateLoginBody(await readJsonBody(request));
      const db = asRawDb(getDb());
      const cfg = authHelpers.getAuthRuntimeConfig();

      const result = await db.$client.query<LoginUserRow>(
        'select id, email, password, name, role, login_attempts as "loginAttempts", lock_until as "lockUntil", token_version as "tokenVersion" from np_users where email = $1 limit 1',
        [email],
      );
      const user = result.rows[0];

      // Anti-enumeration on the missing-user branch (mirrors member
      // login). Wrong password takes the explicit lockout branch
      // below since incrementing attempts is the correct behavior.
      if (!user) throw new NpAuthError("Invalid email or password");

      const now = new Date();
      if (user.lockUntil && user.lockUntil > now) {
        throw new NpError("Too many login attempts", "TOO_MANY_REQUESTS", 429);
      }

      const valid = await verifyPassword(user.password, password);
      if (!valid) {
        const nextAttempts = user.loginAttempts + 1;
        const shouldLock = nextAttempts >= cfg.maxLoginAttempts;
        await db.$client.query(
          "update np_users set login_attempts = $1, lock_until = $2, updated_at = $3 where id = $4",
          [
            nextAttempts,
            shouldLock ? new Date(now.getTime() + cfg.lockoutDuration * 1000) : null,
            now,
            user.id,
          ],
        );
        throw new NpAuthError("Invalid email or password");
      }

      // Reset throttle on success.
      await db.$client.query(
        "update np_users set login_attempts = 0, lock_until = null, updated_at = $1 where id = $2",
        [now, user.id],
      );

      const access = await signToken(user, cfg.secret, cfg.tokenExpiration, "access");
      const refresh = await signToken(user, cfg.secret, cfg.refreshTokenExpiration, "refresh");
      const response = npSuccessResponse({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
      authHelpers.setAuthCookies(response, {
        access,
        refresh,
        csrf: crypto.randomUUID(),
      });

      // Plugin hook — async so a slow plugin can't stall the
      // response. The member-auth flow has no equivalent (members
      // don't trigger admin-side hooks).
      await ensureFor("plugins");
      await runHook("auth:afterLogin", {
        user: { id: user.id, email: user.email, role: user.role },
      });

      return response;
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── logout ─────────────────────────────────────────────────
  const logout = async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = await authHelpers.optionalAuth(request);

      // Per-device logout only — clears local cookies, doesn't
      // bump tokenVersion. Global logout (kill every session) is
      // a separate explicit flow attached to password change /
      // reset, not routine sign-out (#74).
      if (user) {
        await ensureFor("plugins");
        await runHook("auth:beforeLogout", {
          user: { id: user.id, email: user.email, role: user.role },
        });
      }

      const response = npSuccessResponse({ success: true });
      authHelpers.clearAuthCookies(response);
      // Clear the multi-site picker cookie too — without this,
      // the next user on the same device inherits the previous
      // tenant context (#15.7).
      response.cookies.delete("np-admin-site");
      return response;
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── refresh ────────────────────────────────────────────────
  const refresh = async (request: NextRequest): Promise<NextResponse> => {
    try {
      const refreshToken = request.cookies.get("np-refresh")?.value;
      if (!refreshToken) throw new NpAuthError();

      const cfg = authHelpers.getAuthRuntimeConfig();
      // Reject access JWTs presented as refresh triggers — without
      // the `use: "refresh"` check a session cookie value would
      // successfully drive rotation and extend its own life
      // indefinitely.
      const user = await verifyTokenFull(refreshToken, cfg.secret, getDb() as never, "refresh");
      if (!user) throw new NpAuthError();

      const response = npSuccessResponse({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
      authHelpers.setAuthCookies(response, {
        access: await signToken(user, cfg.secret, cfg.tokenExpiration, "access"),
        refresh: await signToken(user, cfg.secret, cfg.refreshTokenExpiration, "refresh"),
        csrf: crypto.randomUUID(),
      });
      return response;
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── forgot-password ────────────────────────────────────────
  const forgotPassword = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const { email } = validateForgotBody(await readJsonBody(request));

      const result = await requestPasswordReset(
        getDb() as never,
        email,
        opts.forgotPassword.tokenTtlMs,
      );

      if (result.issued && result.email && result.name) {
        await enqueueJob("auth:sendPasswordReset", {
          email: result.email,
          name: result.name,
          token: result.issued.token,
          purpose: result.issued.purpose,
          resetUrl: buildResetUrl(config, request, result.issued.token, opts.resetUrlPath),
          siteName: config.site.name,
        });
      }
      // Constant response regardless of match — anti-enumeration.
      return npSuccessResponse({ ok: true });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── reset-password ─────────────────────────────────────────
  const resetPassword = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const { token, password } = validateResetBody(
        await readJsonBody(request),
        opts.resetPassword.minPasswordLength,
      );

      const result = await consumePasswordResetToken(getDb() as never, {
        token,
        newPassword: password,
      });

      return npSuccessResponse({
        ok: true,
        email: result.email,
        purpose: result.purpose,
      });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── change-password (authenticated) ────────────────────────
  const changePassword = async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = await authHelpers.requireAuth(request);
      const { currentPassword, newPassword } = validateChangeBody(
        await readJsonBody(request),
        opts.changePassword.minPasswordLength,
      );
      const db = asRawDb(getDb());

      const result = await db.$client.query<PasswordRow>(
        "select password from np_users where id = $1 limit 1",
        [user.id],
      );
      const stored = result.rows[0];
      if (!stored) throw new NpAuthError();

      const valid = await verifyPassword(stored.password, currentPassword);
      if (!valid) throw new NpAuthError("Current password is incorrect");

      await db.$client.query(
        "update np_users set password = $1, updated_at = $2 where id = $3",
        [await hashPassword(newPassword), new Date(), user.id],
      );

      // Bump tokenVersion + revoke sessions across every device.
      // Caller has to log in again on this device too.
      await invalidateAllSessions(user.id, getDb() as never);

      const response = npSuccessResponse({ success: true });
      authHelpers.clearAuthCookies(response);
      return response;
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── OAuth start ────────────────────────────────────────────
  const oauthStart = async (
    request: NextRequest,
    ctx: { params: Promise<{ provider: string }> },
  ): Promise<NextResponse> => {
    await ensureFor("plugins");
    const { provider: providerId } = await ctx.params;
    const provider = getOAuthProvider(providerId);
    if (!provider) {
      return NextResponse.json(
        {
          error: { code: "NOT_FOUND", message: `OAuth provider "${providerId}" not registered` },
          status: 404,
        },
        { status: 404 },
      );
    }

    const { secret, secureCookies } = authHelpers.getAuthRuntimeConfig();
    const { token, codeVerifier } = issueOAuthState(providerId, secret);
    const redirectUri = new URL(
      `/api/auth/oauth/${providerId}/callback`,
      siteUrl(config, request),
    ).toString();
    const authorizeUrl = await provider.authorize({
      state: token,
      redirectUri,
      codeVerifier,
    });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set({
      name: STATE_COOKIE,
      value: token,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/api/auth/oauth",
      maxAge: STATE_COOKIE_MAX_AGE,
    });
    return response;
  };

  // ─── OAuth callback ─────────────────────────────────────────
  const oauthFail = (request: NextRequest, code: string): NextResponse => {
    const target = new URL(opts.oauth.failureRedirect, siteUrl(config, request));
    target.searchParams.set("oauth_error", code);
    const response = NextResponse.redirect(target);
    response.cookies.set({
      name: STATE_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/oauth",
      maxAge: 0,
    });
    return response;
  };

  const oauthCallback = async (
    request: NextRequest,
    ctx: { params: Promise<{ provider: string }> },
  ): Promise<NextResponse> => {
    await ensureFor("plugins");
    const { provider: providerId } = await ctx.params;
    const provider = getOAuthProvider(providerId);
    if (!provider) return oauthFail(request, "unknown_provider");

    const url = request.nextUrl;
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const stateCookie = request.cookies.get(STATE_COOKIE)?.value;

    if (!code || !stateParam || !stateCookie) {
      return oauthFail(request, "missing_params");
    }
    if (stateParam !== stateCookie) {
      return oauthFail(request, "state_mismatch");
    }

    const cfg = authHelpers.getAuthRuntimeConfig();
    const verification = verifyOAuthState(stateCookie, providerId, cfg.secret);
    if (!verification.ok || !verification.payload) {
      return oauthFail(request, `state_${verification.reason ?? "invalid"}`);
    }

    let profile;
    try {
      profile = await provider.exchange({
        code,
        state: stateParam,
        redirectUri: new URL(
          `/api/auth/oauth/${providerId}/callback`,
          siteUrl(config, request),
        ).toString(),
        codeVerifier: verification.payload.codeVerifier,
      });
    } catch (err) {
      getLogger().error("staff oauth exchange failed", {
        provider: providerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return oauthFail(request, "exchange_failed");
    }

    if (!profile?.providerUserId) {
      getLogger().error("staff oauth exchange returned no providerUserId", {
        provider: providerId,
      });
      return oauthFail(request, "exchange_failed");
    }

    let resolved;
    try {
      resolved = await resolveOAuthLogin({ provider: providerId, profile });
    } catch (err) {
      getLogger().error("staff oauth identity resolve failed", {
        provider: providerId,
        providerUserId: profile.providerUserId,
        error: err instanceof Error ? err.message : String(err),
      });
      return oauthFail(request, "resolve_failed");
    }

    const access = await signToken(
      resolved.user,
      cfg.secret,
      cfg.tokenExpiration,
      "access",
    );
    const refresh = await signToken(
      resolved.user,
      cfg.secret,
      cfg.refreshTokenExpiration,
      "refresh",
    );

    const target = new URL(opts.oauth.successRedirect, siteUrl(config, request));
    const response = NextResponse.redirect(target);
    authHelpers.setAuthCookies(response, { access, refresh, csrf: crypto.randomUUID() });
    response.cookies.set({
      name: STATE_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/oauth",
      maxAge: 0,
    });
    return response;
  };

  // ─── /me ────────────────────────────────────────────────────
  const meGet = async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = await authHelpers.requireAuth(request);
      return npSuccessResponse({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  return {
    login,
    logout,
    refresh,
    forgotPassword,
    resetPassword,
    changePassword,
    oauthStart,
    oauthCallback,
    meGet,
  };
}

// ─── shared validators ───────────────────────────────────────

function validateLoginBody(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || !email.includes("@")) {
    throw new NpValidationError("Invalid input", [
      { field: "email", message: "Valid email is required" },
    ]);
  }
  if (typeof password !== "string" || password.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "password", message: "Password is required" },
    ]);
  }
  return { email, password };
}

function validateForgotBody(body: unknown): { email: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }
  const { email } = body as { email?: unknown };
  if (typeof email !== "string" || !email.includes("@")) {
    throw new NpValidationError("Invalid input", [
      { field: "email", message: "Valid email is required" },
    ]);
  }
  return { email };
}

function validateResetBody(
  body: unknown,
  minPasswordLength: number,
): { token: string; password: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }
  const { token, password } = body as { token?: unknown; password?: unknown };
  if (typeof token !== "string" || token.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "token", message: "Reset token is required" },
    ]);
  }
  if (typeof password !== "string" || password.length < minPasswordLength) {
    throw new NpValidationError("Invalid input", [
      { field: "password", message: `Password must be at least ${minPasswordLength} characters` },
    ]);
  }
  return { token, password };
}

function validateChangeBody(
  body: unknown,
  minPasswordLength: number,
): { currentPassword: string; newPassword: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }
  const { currentPassword, newPassword } = body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "currentPassword", message: "Current password is required" },
    ]);
  }
  if (typeof newPassword !== "string" || newPassword.length < minPasswordLength) {
    throw new NpValidationError("Invalid input", [
      {
        field: "newPassword",
        message: `New password must be at least ${minPasswordLength} characters`,
      },
    ]);
  }
  return { currentPassword, newPassword };
}

function buildResetUrl(
  config: StaffAuthRoutesConfig,
  request: NextRequest,
  token: string,
  resetUrlPath: string,
): string {
  const url = new URL(resetUrlPath, siteUrl(config, request));
  url.searchParams.set("token", token);
  return url.toString();
}

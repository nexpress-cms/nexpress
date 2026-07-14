import {
  NpAuthError,
  NpError,
  NpValidationError,
  consumePasswordResetToken,
  createStaffSession,
  enqueueJob,
  getLogger,
  getOAuthProvider,
  hashPassword,
  issueOAuthState,
  oauthProviderSupportsAudience,
  requestPasswordReset,
  replaceStaffPasswordAndInvalidateSessions,
  resolveOAuthLogin,
  rotateStaffSession,
  runHook,
  verifyOAuthState,
  verifyPassword,
  type NpUserRole,
} from "@nexpress/core";
import {
  npAuthContractLimits,
  npIsAuthSingleUseToken,
  npIsAuthNewPassword,
  npIsAuthPasswordCandidate,
  npIsCanonicalAuthEmail,
  npRequireStaffSessionUser,
} from "@nexpress/core/auth-contract";
import { npErrorResponse, npSuccessResponse, readJsonBody } from "@nexpress/next";
import { NextResponse, type NextRequest } from "next/server";

import type {
  StaffAuthRoutes,
  StaffAuthRoutesConfig,
  StaffAuthRoutesOptions,
} from "./staff-types.js";
import { siteUrlLenient, siteUrlStrict } from "./site-url.js";

const STATE_COOKIE = "np-oauth-state";
const DEFAULTS = {
  forgotPassword: { tokenTtlMs: 60 * 60_000 },
  oauth: { successRedirect: "/admin", failureRedirect: "/admin/login" },
  resetUrlPath: "/admin/set-password",
} as const;

function resolved(o: StaffAuthRoutesOptions = {}) {
  const result = {
    forgotPassword: { ...DEFAULTS.forgotPassword, ...o.forgotPassword },
    oauth: { ...DEFAULTS.oauth, ...o.oauth },
    resetUrlPath: o.resetUrlPath ?? DEFAULTS.resetUrlPath,
  };
  if (
    !Number.isSafeInteger(result.forgotPassword.tokenTtlMs) ||
    result.forgotPassword.tokenTtlMs <= 0 ||
    result.forgotPassword.tokenTtlMs > 365 * 24 * 60 * 60_000
  ) {
    throw new Error(
      "options.forgotPassword.tokenTtlMs must be a positive integer no longer than 365 days.",
    );
  }
  return result;
}

function siteUrl(config: StaffAuthRoutesConfig, request: NextRequest): URL {
  return siteUrlLenient(config, request);
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
      // The pre-migration login route called `getDb()` directly
      // without `ensureFor` and relied on cold-start ordering
      // (proxy.ts middleware happening to init first). Make the
      // dependency explicit — `"write"` covers DB + email +
      // pg-boss producer, all of which the login flow ends up
      // touching (DB writes, the runHook below may fan out to a
      // plugin that enqueues a job).
      await ensureFor("write");
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
        await db.$client.query(
          `update np_users
              set login_attempts = login_attempts + 1,
                  lock_until = case
                    when login_attempts + 1 >= $1 then $2
                    else lock_until
                  end,
                  updated_at = $3
            where id = $4`,
          [
            cfg.maxLoginAttempts,
            new Date(now.getTime() + cfg.lockoutDuration * 1000),
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

      const session = await createStaffSession(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tokenVersion: user.tokenVersion,
        },
        cfg.secret,
        getDb() as never,
        {
          accessExpiration: cfg.tokenExpiration,
          refreshExpiration: cfg.refreshTokenExpiration,
          ...requestMetadata(request),
        },
      );
      const response = npSuccessResponse({
        user: npRequireStaffSessionUser({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        }),
      });
      authHelpers.setAuthCookies(response, {
        access: session.access,
        refresh: session.refresh,
        csrf: crypto.randomUUID(),
      });

      // Plugin hook — the host owns its timeout policy. The member-auth flow
      // has no equivalent (members don't trigger admin-side hooks). Plugins
      // are already loaded by the top-of-handler `ensureFor("write")`.
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
    let response: NextResponse;
    try {
      // Load plugins before the hook and atomically revoke the browser session
      // families selected by every live token's shared `sid`.
      await ensureFor("write");
      const user = await authHelpers.revokeCurrentAuthSession(request);

      // Per-device logout leaves other session families alive. Password change
      // and reset remain the explicit global-revocation paths.
      if (user) {
        await runHook("auth:beforeLogout", {
          user: { id: user.id, email: user.email, role: user.role },
        });
      }

      response = npSuccessResponse({ success: true });
    } catch (error) {
      response = npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
    authHelpers.clearAuthCookies(response);
    // Clear the multi-site picker cookie too — without this,
    // the next user on the same device inherits the previous
    // tenant context (#15.7).
    response.cookies.delete("np-admin-site");
    return response;
  };

  // ─── refresh ────────────────────────────────────────────────
  const refresh = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const refreshToken = request.cookies.get("np-refresh")?.value;
      if (!refreshToken) throw new NpAuthError();

      const cfg = authHelpers.getAuthRuntimeConfig();
      const session = await rotateStaffSession(refreshToken, cfg.secret, getDb() as never, {
        accessExpiration: cfg.tokenExpiration,
        refreshExpiration: cfg.refreshTokenExpiration,
        ...requestMetadata(request),
      });
      if (!session) throw new NpAuthError();

      const response = npSuccessResponse({
        user: npRequireStaffSessionUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role,
        }),
      });
      authHelpers.setAuthCookies(response, {
        access: session.access,
        refresh: session.refresh,
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
      // Validate SITE_URL upfront so the failure mode is uniform
      // for real and fake emails (#598). See `siteUrlStrict` doc.
      siteUrlStrict(config);

      const result = await requestPasswordReset(
        getDb() as never,
        email,
        opts.forgotPassword.tokenTtlMs,
      );

      if (result.issued && result.email && result.name) {
        await enqueueJob("auth:sendPasswordReset", {
          email: result.email,
          name: result.name,
          purpose: result.issued.purpose,
          resetUrl: buildResetUrl(config, request, result.issued.token, opts.resetUrlPath),
          expiresAt: result.issued.expiresAt.toISOString(),
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
      const { token, password } = validateResetBody(await readJsonBody(request));

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
      // Writes the password, bumps tokenVersion, and deletes sessions in one
      // transaction. `"write"` is the right bootstrap intent.
      await ensureFor("write");
      const user = await authHelpers.requireAuth(request);
      const { currentPassword, newPassword } = validateChangeBody(await readJsonBody(request));
      const db = asRawDb(getDb());

      const result = await db.$client.query<PasswordRow>(
        "select password from np_users where id = $1 limit 1",
        [user.id],
      );
      const stored = result.rows[0];
      if (!stored) throw new NpAuthError();

      const valid = await verifyPassword(stored.password, currentPassword);
      if (!valid) throw new NpAuthError("Current password is incorrect");

      // Password, tokenVersion, and every session family change together.
      // Caller has to log in again on this device too.
      const replaced = await replaceStaffPasswordAndInvalidateSessions(
        user.id,
        stored.password,
        await hashPassword(newPassword),
        getDb() as never,
      );
      if (!replaced) throw new NpAuthError("Current password is incorrect");

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
    if (!provider || !oauthProviderSupportsAudience(provider, "staff")) {
      return NextResponse.json(
        {
          error: { code: "NOT_FOUND", message: `OAuth provider "${providerId}" not registered` },
          status: 404,
        },
        { status: 404 },
      );
    }

    const { secret, secureCookies } = authHelpers.getAuthRuntimeConfig();
    const { token, codeVerifier, expiresInSeconds } = issueOAuthState(providerId, secret);
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
      maxAge: expiresInSeconds,
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
    await ensureFor("write");
    const { provider: providerId } = await ctx.params;
    const provider = getOAuthProvider(providerId);
    if (!provider || !oauthProviderSupportsAudience(provider, "staff")) {
      return oauthFail(request, "unknown_provider");
    }

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

    const session = await createStaffSession(
      {
        id: resolved.user.id,
        email: resolved.user.email,
        name: resolved.user.name,
        role: resolved.user.role,
        tokenVersion: resolved.user.tokenVersion,
      },
      cfg.secret,
      getDb() as never,
      {
        accessExpiration: cfg.tokenExpiration,
        refreshExpiration: cfg.refreshTokenExpiration,
        ...requestMetadata(request),
      },
    );

    const target = new URL(opts.oauth.successRedirect, siteUrl(config, request));
    const response = NextResponse.redirect(target);
    authHelpers.setAuthCookies(response, {
      access: session.access,
      refresh: session.refresh,
      csrf: crypto.randomUUID(),
    });
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
      // `requireAuth` queries `np_users` to validate the session.
      await ensureFor("read");
      const user = await authHelpers.requireAuth(request);
      return npSuccessResponse({
        user: npRequireStaffSessionUser({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        }),
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
  const record = requireBodyRecord(body, ["email", "password"]);
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const password = record.password;
  if (!npIsCanonicalAuthEmail(email)) {
    throw new NpValidationError("Invalid input", [
      { field: "email", message: "Valid email is required" },
    ]);
  }
  if (!npIsAuthPasswordCandidate(password)) {
    throw new NpValidationError("Invalid input", [
      { field: "password", message: "Password is required" },
    ]);
  }
  return { email, password };
}

function requestMetadata(request: NextRequest): { userAgent: string | null; ip: string | null } {
  return {
    userAgent: request.headers.get("user-agent"),
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

function validateForgotBody(body: unknown): { email: string } {
  const record = requireBodyRecord(body, ["email"]);
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  if (!npIsCanonicalAuthEmail(email)) {
    throw new NpValidationError("Invalid input", [
      { field: "email", message: "Valid email is required" },
    ]);
  }
  return { email };
}

function validateResetBody(body: unknown): { token: string; password: string } {
  const { token, password } = requireBodyRecord(body, ["token", "password"]);
  if (!npIsAuthSingleUseToken(token)) {
    throw new NpValidationError("Invalid input", [
      { field: "token", message: "Reset token is required" },
    ]);
  }
  if (!npIsAuthNewPassword(password)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "password",
        message: `Password must contain ${npAuthContractLimits.passwordMinLength} through ${npAuthContractLimits.passwordMaxLength} characters`,
      },
    ]);
  }
  return { token, password };
}

function validateChangeBody(body: unknown): { currentPassword: string; newPassword: string } {
  const { currentPassword, newPassword } = requireBodyRecord(body, [
    "currentPassword",
    "newPassword",
  ]);
  if (!npIsAuthPasswordCandidate(currentPassword)) {
    throw new NpValidationError("Invalid input", [
      { field: "currentPassword", message: "Current password is required" },
    ]);
  }
  if (!npIsAuthNewPassword(newPassword)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "newPassword",
        message: `New password must contain ${npAuthContractLimits.passwordMinLength} through ${npAuthContractLimits.passwordMaxLength} characters`,
      },
    ]);
  }
  return { currentPassword, newPassword };
}

function requireBodyRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }
  const record = value as Record<string, unknown>;
  const unknownField = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unknownField) {
    throw new NpValidationError("Invalid input", [
      { field: unknownField, message: "Unsupported authentication field" },
    ]);
  }
  return record;
}

function buildResetUrl(
  config: StaffAuthRoutesConfig,
  _request: NextRequest,
  token: string,
  resetUrlPath: string,
): string {
  // Email-deliverable URL — strict siteUrl prevents Host-header
  // injection (#598). See `siteUrlStrict` doc comment.
  const url = new URL(resetUrlPath, siteUrlStrict(config));
  url.searchParams.set("token", token);
  return url.toString();
}

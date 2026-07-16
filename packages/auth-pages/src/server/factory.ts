import { randomBytes } from "node:crypto";

import {
  NpAuthError,
  NpError,
  NpForbiddenError,
  NpValidationError,
  consumeMemberEmailVerifyToken,
  consumeMemberPasswordReset,
  createMemberEmailVerifyToken,
  createMemberSession,
  enqueueJob,
  getCommunitySettings,
  getLogger,
  getOAuthProvider,
  hashPassword,
  invalidateAllMemberSessions,
  issueOAuthState,
  npMembers,
  oauthProviderSupportsAudience,
  requestMemberPasswordReset,
  replaceMemberPasswordAndInvalidateSessions,
  resolveMemberOAuthLogin,
  rotateMemberSession,
  verifyOAuthState,
  verifyPassword,
} from "@nexpress/core";
import {
  npAuthContractLimits,
  npIsAuthSingleUseToken,
  npIsAuthNewPassword,
  npIsAuthPasswordCandidate,
  npIsCanonicalAuthEmail,
  npIsCanonicalAuthId,
  npIsCanonicalMemberHandle,
  npRequireMemberSelf,
  npRequireMemberSessionUser,
} from "@nexpress/core/auth-contract";
import { npErrorResponse, npSuccessResponse, readJsonBody } from "@nexpress/next";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NextResponse, type NextRequest } from "next/server";

import type { MemberAuthRoutes, MemberAuthRoutesConfig, MemberAuthRoutesOptions } from "./types.js";
import { siteUrlLenient, siteUrlStrict } from "./site-url.js";

/**
 * Drizzle-shaped database surface this factory calls. The real
 * db (`getDb()` from the app) is `NodePgDatabase<schema>`, but
 * importing that generic here would force the package to know
 * the app's schema union. We narrow to the empty-schema variant
 * which keeps method-builder return types intact; the runtime
 * shape is identical.
 */
type AnyDb = NodePgDatabase<Record<string, never>>;

function asDb(handle: unknown): AnyDb {
  return handle as AnyDb;
}

const STATE_COOKIE = "np-mb-oauth-state";
const DEFAULTS = {
  emailVerify: { tokenTtlMs: 24 * 60 * 60_000 },
  forgotPassword: { tokenTtlMs: 60 * 60_000 },
  oauth: { successRedirect: "/", failureRedirect: "/members/login" },
} as const;

function resolved(o: MemberAuthRoutesOptions = {}) {
  const result = {
    emailVerify: { ...DEFAULTS.emailVerify, ...o.emailVerify },
    forgotPassword: { ...DEFAULTS.forgotPassword, ...o.forgotPassword },
    oauth: { ...DEFAULTS.oauth, ...o.oauth },
  };
  requirePositiveDuration(result.emailVerify.tokenTtlMs, "options.emailVerify.tokenTtlMs");
  requirePositiveDuration(result.forgotPassword.tokenTtlMs, "options.forgotPassword.tokenTtlMs");
  return result;
}

function requirePositiveDuration(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 365 * 24 * 60 * 60_000) {
    throw new Error(`${path} must be a positive integer no longer than 365 days.`);
  }
}

function siteUrl(config: MemberAuthRoutesConfig, request: NextRequest): URL {
  return siteUrlLenient(config, request);
}

function buildPath(config: MemberAuthRoutesConfig, request: NextRequest, path: string): string {
  const url = new URL(path, siteUrl(config, request));
  return url.toString();
}

/**
 * Bootstrap factory. Call once per app — typically in
 * `apps/<app>/src/lib/auth-routes.ts` — and each
 * `app/api/members/<flow>/route.ts` re-exports the matching
 * property as its `POST` / `GET` / `PATCH` / `DELETE`. The
 * returned handlers carry the full app wiring (DB, auth helpers,
 * site identity, options) so route files become two lines.
 */
export function createMemberAuthRoutes(config: MemberAuthRoutesConfig): MemberAuthRoutes {
  const opts = resolved(config.options);
  const { getDb, ensureFor, authHelpers } = config;

  // ─── login ──────────────────────────────────────────────────
  const login = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const { email, password } = validateLoginBody(await readJsonBody(request));
      const db = getDb() as never;
      const runtime = authHelpers.getMemberAuthRuntimeConfig();

      const [member] = await asDb(db)
        .select({
          id: npMembers.id,
          email: npMembers.email,
          handle: npMembers.handle,
          displayName: npMembers.displayName,
          password: npMembers.password,
          status: npMembers.status,
          tokenVersion: npMembers.tokenVersion,
          loginAttempts: npMembers.loginAttempts,
          lockUntil: npMembers.lockUntil,
        })
        .from(npMembers)
        .where(eq(npMembers.email, email))
        .limit(1);

      // Anti-enumeration: missing-account / wrong-password / pending
      // / suspended / deleted all surface the same generic error.
      if (!member || !member.password) throw new NpAuthError("Invalid credentials");

      if (member.lockUntil && member.lockUntil > new Date()) {
        throw new NpAuthError("Account is temporarily locked");
      }

      const ok = await verifyPassword(member.password, password);
      if (!ok) {
        const lockoutSql = sql`case when ${npMembers.loginAttempts} + 1 >= ${runtime.maxLoginAttempts} then now() + ${runtime.lockoutDuration * 1000} * interval '1 millisecond' else ${npMembers.lockUntil} end`;
        await asDb(db)
          .update(npMembers)
          .set({
            loginAttempts: sql`${npMembers.loginAttempts} + 1`,
            lockUntil: lockoutSql,
            updatedAt: new Date(),
          })
          .where(eq(npMembers.id, member.id));
        throw new NpAuthError("Invalid credentials");
      }

      if (member.status !== "active") {
        throw new NpAuthError("Invalid credentials");
      }

      await asDb(db)
        .update(npMembers)
        .set({ loginAttempts: 0, lockUntil: null, updatedAt: new Date() })
        .where(eq(npMembers.id, member.id));

      const { secret, tokenExpiration, refreshTokenExpiration } = runtime;
      const session = await createMemberSession(
        {
          id: member.id,
          email: member.email,
          handle: member.handle,
          displayName: member.displayName,
          status: member.status,
          tokenVersion: member.tokenVersion,
        },
        secret,
        db,
        {
          accessExpiration: tokenExpiration,
          refreshExpiration: refreshTokenExpiration,
          ...requestMetadata(request),
        },
      );
      const csrf = randomBytes(16).toString("hex");

      const response = NextResponse.json(
        {
          member: npRequireMemberSessionUser({
            id: member.id,
            handle: member.handle,
            email: member.email,
            displayName: member.displayName,
          }),
        },
        { status: 200 },
      );
      authHelpers.setMemberAuthCookies(response, {
        access: session.access,
        refresh: session.refresh,
        csrf,
      });
      return response;
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── register ───────────────────────────────────────────────
  const register = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");

      const settings = await getCommunitySettings();
      if (!settings.registrationEnabled) {
        throw new NpForbiddenError("members", "register");
      }

      // Validate SITE_URL upfront so registration of an existing
      // account vs a new account fails the same way when SITE_URL
      // is unset (#598). Without this check, existing-account
      // returns 200 (no buildVerifyUrl call) while new-account
      // 500s on the buildVerifyUrl throw, leaking account
      // existence.
      siteUrlStrict(config);

      const body = validateRegisterBody(await readJsonBody(request));
      const db = getDb() as never;

      const [existingByEmail] = await asDb(db)
        .select({ id: npMembers.id })
        .from(npMembers)
        .where(eq(npMembers.email, body.email))
        .limit(1);
      const [existingByHandle] = await asDb(db)
        .select({ id: npMembers.id })
        .from(npMembers)
        .where(eq(npMembers.handle, body.handle))
        .limit(1);

      if (existingByEmail || existingByHandle) {
        return npSuccessResponse({ ok: true });
      }

      const passwordHash = await hashPassword(body.password);

      let created: { id: string } | undefined;
      try {
        [created] = await asDb(db)
          .insert(npMembers)
          .values({
            email: body.email,
            password: passwordHash,
            handle: body.handle,
            displayName: body.displayName,
            status: "pending",
          })
          .returning({ id: npMembers.id });
      } catch (err) {
        // SQLSTATE 23505 — concurrent collision after preflight pass.
        if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
          return npSuccessResponse({ ok: true });
        }
        throw err;
      }

      if (!created) throw new Error("Failed to create member");

      const issued = await createMemberEmailVerifyToken(
        db,
        created.id,
        opts.emailVerify.tokenTtlMs,
      );

      await enqueueJob("members:sendVerifyEmail", {
        email: body.email,
        displayName: body.displayName,
        verifyUrl: buildVerifyUrl(config, request, issued.token),
        expiresAt: issued.expiresAt.toISOString(),
        siteName: config.site.name,
      });

      return npSuccessResponse({ ok: true });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── logout ─────────────────────────────────────────────────
  const logout = async (request: NextRequest): Promise<NextResponse> => {
    let response: NextResponse;
    try {
      await ensureFor("write");
      await authHelpers.revokeCurrentMemberSession(request);
      response = NextResponse.json({ ok: true }, { status: 200 });
    } catch (error) {
      response = npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
    authHelpers.clearMemberAuthCookies(response);
    return response;
  };

  // ─── refresh ────────────────────────────────────────────────
  const refresh = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const refreshToken = request.cookies.get("np-mb-refresh")?.value;
      if (!refreshToken) throw new NpAuthError();

      const { secret, tokenExpiration, refreshTokenExpiration } =
        authHelpers.getMemberAuthRuntimeConfig();
      const session = await rotateMemberSession(refreshToken, secret, getDb() as never, {
        accessExpiration: tokenExpiration,
        refreshExpiration: refreshTokenExpiration,
        ...requestMetadata(request),
      });
      if (!session || session.member.status !== "active") throw new NpAuthError();
      const csrf = randomBytes(16).toString("hex");

      const response = NextResponse.json(
        {
          member: npRequireMemberSessionUser({
            id: session.member.id,
            handle: session.member.handle,
            email: session.member.email,
            displayName: session.member.displayName,
          }),
        },
        { status: 200 },
      );
      authHelpers.setMemberAuthCookies(response, {
        access: session.access,
        refresh: session.refresh,
        csrf,
      });
      return response;
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── verify email ───────────────────────────────────────────
  const verifyEmail = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const body = requireBodyRecord(await readJsonBody(request), ["token"]);
      const token = npIsAuthSingleUseToken(body.token) ? body.token : "";
      const result = await consumeMemberEmailVerifyToken(getDb() as never, token);
      return npSuccessResponse({
        memberId: result.memberId,
        handle: result.handle,
        email: result.email,
      });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── forgot-password ────────────────────────────────────────
  const forgotPassword = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const body = requireBodyRecord(await readJsonBody(request), ["email"]);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!npIsCanonicalAuthEmail(email)) {
        throw new NpValidationError("Invalid input", [
          { field: "email", message: "Valid email required" },
        ]);
      }
      // Validate SITE_URL upfront so the failure mode is uniform
      // for real and fake emails (#598). If we waited until the
      // conditional `buildResetUrl(...)` call, real-account
      // requests would 500 while fake-account requests would 200,
      // leaking account existence. Failing early keeps anti-
      // enumeration intact when SITE_URL is unset.
      siteUrlStrict(config);

      const result = await requestMemberPasswordReset(
        getDb() as never,
        email,
        opts.forgotPassword.tokenTtlMs,
      );
      if (result.issued && result.email && result.displayName) {
        await enqueueJob("members:sendPasswordReset", {
          email: result.email,
          displayName: result.displayName,
          resetUrl: buildResetUrl(config, request, result.issued.token),
          expiresAt: result.issued.expiresAt.toISOString(),
          siteName: config.site.name,
        });
      }
      return npSuccessResponse({ ok: true });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── reset-password ─────────────────────────────────────────
  const resetPassword = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const body = requireBodyRecord(await readJsonBody(request), ["token", "password"]);
      const token = npIsAuthSingleUseToken(body.token) ? body.token : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!npIsAuthNewPassword(password)) {
        throw new NpValidationError("Invalid input", [
          {
            field: "password",
            message: `Password must contain ${npAuthContractLimits.passwordMinLength} through ${npAuthContractLimits.passwordMaxLength} characters`,
          },
        ]);
      }
      const result = await consumeMemberPasswordReset(getDb() as never, token, password);
      return npSuccessResponse({ memberId: result.memberId, email: result.email });
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
    if (!provider || !oauthProviderSupportsAudience(provider, "member")) {
      return npErrorResponse(
        new NpError(`OAuth provider "${providerId}" not registered`, "NOT_FOUND", 404),
      );
    }

    const { secret, secureCookies } = authHelpers.getMemberAuthRuntimeConfig();
    const { token, codeVerifier, expiresInSeconds } = issueOAuthState(providerId, secret);
    const redirectUri = buildPath(config, request, `/api/members/oauth/${providerId}/callback`);
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
      path: "/api/members/oauth",
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
      path: "/api/members/oauth",
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
    if (!provider || !oauthProviderSupportsAudience(provider, "member")) {
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

    const { secret, tokenExpiration, refreshTokenExpiration } =
      authHelpers.getMemberAuthRuntimeConfig();
    const verification = verifyOAuthState(stateCookie, providerId, secret);
    if (!verification.ok || !verification.payload) {
      return oauthFail(request, `state_${verification.reason ?? "invalid"}`);
    }

    let profile;
    try {
      profile = await provider.exchange({
        code,
        state: stateParam,
        redirectUri: buildPath(config, request, `/api/members/oauth/${providerId}/callback`),
        codeVerifier: verification.payload.codeVerifier,
      });
    } catch (err) {
      getLogger().error("member oauth exchange failed", {
        provider: providerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return oauthFail(request, "exchange_failed");
    }

    if (!profile?.providerUserId) {
      getLogger().error("member oauth exchange returned no providerUserId", {
        provider: providerId,
      });
      return oauthFail(request, "exchange_failed");
    }

    let resolved;
    try {
      resolved = await resolveMemberOAuthLogin({ provider: providerId, profile });
    } catch (err) {
      if (err instanceof NpForbiddenError) {
        return oauthFail(request, "registration_disabled");
      }
      getLogger().error("member oauth identity resolve failed", {
        provider: providerId,
        providerUserId: profile.providerUserId,
        error: err instanceof Error ? err.message : String(err),
      });
      return oauthFail(request, "resolve_failed");
    }

    // Suspended / deleted / pending members can't sign in even via
    // OAuth. `resolveMemberOAuthLogin` deliberately returns
    // non-active rows as-is and expects the route to gate them
    // here — see the comment in oauth-resolve-member.ts (~L170).
    // Without this check an attacker who controls an OAuth account
    // matching a victim's email could complete sign-in for a
    // suspended account.
    if (resolved.member.status !== "active") {
      return oauthFail(request, "member_inactive");
    }

    const member = resolved.member;
    const session = await createMemberSession(
      {
        id: member.id,
        email: member.email,
        handle: member.handle,
        displayName: member.displayName,
        status: member.status,
        tokenVersion: member.tokenVersion,
      },
      secret,
      getDb() as never,
      {
        accessExpiration: tokenExpiration,
        refreshExpiration: refreshTokenExpiration,
        ...requestMetadata(request),
      },
    );
    const csrf = randomBytes(16).toString("hex");

    const target = new URL(opts.oauth.successRedirect, siteUrl(config, request));
    const response = NextResponse.redirect(target);
    response.cookies.set({
      name: STATE_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      path: "/api/members/oauth",
      maxAge: 0,
    });
    authHelpers.setMemberAuthCookies(response, {
      access: session.access,
      refresh: session.refresh,
      csrf,
    });
    return response;
  };

  // ─── /me GET / PATCH / DELETE ───────────────────────────────
  const meGet = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("read");
      const member = await authHelpers.requireMember(request);

      const db = getDb() as never;
      const [row] = await asDb(db)
        .select({
          id: npMembers.id,
          handle: npMembers.handle,
          email: npMembers.email,
          emailVerified: npMembers.emailVerified,
          displayName: npMembers.displayName,
          avatar: npMembers.avatar,
          bio: npMembers.bio,
          status: npMembers.status,
          reputation: npMembers.reputation,
          createdAt: npMembers.createdAt,
        })
        .from(npMembers)
        .where(eq(npMembers.id, member.id))
        .limit(1);

      if (!row) throw new Error("Member row vanished mid-request");
      if (row.status !== "active") throw new NpAuthError();
      return npSuccessResponse({
        member: npRequireMemberSelf({
          ...row,
          createdAt: row.createdAt.toISOString(),
        }),
      });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  const mePatch = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const member = await authHelpers.requireMember(request);
      const patch = validatePatchBody(await readJsonBody(request));
      const db = getDb() as never;

      const profileUpdates: {
        displayName?: string;
        bio?: string | null;
        avatar?: string | null;
      } = {};
      if (patch.displayName !== undefined) profileUpdates.displayName = patch.displayName;
      if (patch.bio !== undefined) profileUpdates.bio = patch.bio;
      if (patch.avatar !== undefined) profileUpdates.avatar = patch.avatar;

      let newPasswordHash: string | null = null;
      let expectedPasswordHash: string | null = null;
      if (patch.newPassword) {
        const [row] = await asDb(db)
          .select({ password: npMembers.password })
          .from(npMembers)
          .where(eq(npMembers.id, member.id))
          .limit(1);
        if (!row?.password) {
          throw new NpValidationError("Invalid input", [
            { field: "currentPassword", message: "Account has no password set (SSO-only)" },
          ]);
        }
        const ok = await verifyPassword(row.password, patch.currentPassword!);
        if (!ok) {
          throw new NpValidationError("Invalid input", [
            { field: "currentPassword", message: "Current password is incorrect" },
          ]);
        }
        expectedPasswordHash = row.password;
        newPasswordHash = await hashPassword(patch.newPassword);
      }

      if (newPasswordHash) {
        if (!expectedPasswordHash) throw new NpAuthError();
        const replaced = await replaceMemberPasswordAndInvalidateSessions(
          db,
          member.id,
          expectedPasswordHash,
          newPasswordHash,
          profileUpdates,
        );
        if (!replaced) throw new NpAuthError("Current password is incorrect");
        const response = NextResponse.json({ ok: true, mustReauth: true }, { status: 200 });
        authHelpers.clearMemberAuthCookies(response);
        return response;
      }

      if (Object.keys(profileUpdates).length > 0) {
        await asDb(db)
          .update(npMembers)
          .set({ ...profileUpdates, updatedAt: new Date() })
          .where(eq(npMembers.id, member.id));
      }

      return npSuccessResponse({ ok: true });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  const meDelete = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const member = await authHelpers.requireMember(request);
      const db = getDb() as never;

      await asDb(db)
        .update(npMembers)
        .set({
          status: "deleted",
          // Append the id to email + handle so the unique constraints
          // free up the original strings — re-registration with the
          // same email works for the same human if they ever come
          // back.
          email: `deleted+${member.id}@deleted.local`,
          handle: `deleted-${member.id.slice(0, 8)}`,
          displayName: "Deleted member",
          password: null,
          bio: null,
          avatar: null,
          // Clear pending verify / reset tokens too — defense in
          // depth so a stale email link from before the delete
          // can't be redeemed against the soft-deleted row.
          emailVerified: false,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          emailVerifyTokenHash: null,
          emailVerifyExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(npMembers.id, member.id));

      await invalidateAllMemberSessions(db, member.id);
      const response = NextResponse.json({ ok: true }, { status: 200 });
      authHelpers.clearMemberAuthCookies(response);
      return response;
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  return {
    login,
    register,
    logout,
    refresh,
    verifyEmail,
    forgotPassword,
    resetPassword,
    oauthStart,
    oauthCallback,
    meGet,
    mePatch,
    meDelete,
  };
}

// ─── shared validators ───────────────────────────────────────

function validateLoginBody(raw: unknown): { email: string; password: string } {
  const body = requireBodyRecord(raw, ["email", "password"]);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = npIsAuthPasswordCandidate(body.password) ? body.password : "";
  if (!npIsCanonicalAuthEmail(email) || !password) {
    throw new NpValidationError("Invalid input", [
      { field: "credentials", message: "Email and password required" },
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

function validateRegisterBody(raw: unknown): {
  email: string;
  password: string;
  handle: string;
  displayName: string;
} {
  const body = requireBodyRecord(raw, ["email", "password", "handle", "displayName"]);
  const errors: Array<{ field: string; message: string }> = [];

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!npIsCanonicalAuthEmail(email)) {
    errors.push({ field: "email", message: "Valid email required" });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!npIsAuthNewPassword(password)) {
    errors.push({
      field: "password",
      message: `Password must contain ${npAuthContractLimits.passwordMinLength} through ${npAuthContractLimits.passwordMaxLength} characters`,
    });
  }

  const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase() : "";
  if (!npIsCanonicalMemberHandle(handle)) {
    errors.push({
      field: "handle",
      message: "Handle must be 3–30 chars: lowercase letters, digits, underscore, dash",
    });
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (displayName.length === 0 || displayName.length > npAuthContractLimits.displayNameLength) {
    errors.push({
      field: "displayName",
      message: `Display name 1–${npAuthContractLimits.displayNameLength.toString()} characters`,
    });
  }

  if (errors.length > 0) throw new NpValidationError("Invalid input", errors);
  return { email, password, handle, displayName };
}

interface PatchBody {
  displayName?: string;
  bio?: string | null;
  avatar?: string | null;
  newPassword?: string;
  currentPassword?: string;
}

function validatePatchBody(raw: unknown): PatchBody {
  const body = requireBodyRecord(raw, [
    "displayName",
    "bio",
    "avatar",
    "newPassword",
    "currentPassword",
  ]);
  const out: PatchBody = {};
  if (body.displayName !== undefined) {
    if (
      typeof body.displayName !== "string" ||
      body.displayName.trim().length === 0 ||
      body.displayName.trim().length > npAuthContractLimits.displayNameLength
    ) {
      throw new NpValidationError("Invalid input", [
        {
          field: "displayName",
          message: `Display name must contain 1 through ${npAuthContractLimits.displayNameLength.toString()} characters`,
        },
      ]);
    }
    out.displayName = body.displayName.trim();
  }
  if (body.bio !== undefined) {
    if (
      body.bio !== null &&
      (typeof body.bio !== "string" || body.bio.length > npAuthContractLimits.bioLength)
    ) {
      throw new NpValidationError("Invalid input", [
        {
          field: "bio",
          message: `Bio must be null or at most ${npAuthContractLimits.bioLength.toString()} characters`,
        },
      ]);
    }
    out.bio = body.bio;
  }
  if (body.avatar !== undefined) {
    if (body.avatar !== null && !npIsCanonicalAuthId(body.avatar)) {
      throw new NpValidationError("Invalid input", [
        { field: "avatar", message: "Avatar must be a UUID or null" },
      ]);
    }
    out.avatar = body.avatar;
  }
  if (body.newPassword !== undefined) {
    if (!npIsAuthNewPassword(body.newPassword)) {
      throw new NpValidationError("Invalid input", [
        {
          field: "newPassword",
          message: `Password must contain ${npAuthContractLimits.passwordMinLength} through ${npAuthContractLimits.passwordMaxLength} characters`,
        },
      ]);
    }
    if (!npIsAuthPasswordCandidate(body.currentPassword)) {
      throw new NpValidationError("Invalid input", [
        { field: "currentPassword", message: "Current password required to change password" },
      ]);
    }
    out.newPassword = body.newPassword;
    out.currentPassword = body.currentPassword;
  } else if (body.currentPassword !== undefined) {
    throw new NpValidationError("Invalid input", [
      { field: "currentPassword", message: "currentPassword requires newPassword" },
    ]);
  }
  if (Object.keys(out).length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "At least one profile field is required" },
    ]);
  }
  return out;
}

function requireBodyRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const record = value as Record<string, unknown>;
  const unknownField = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unknownField) {
    throw new NpValidationError("Invalid input", [
      { field: unknownField, message: "Unsupported member authentication field" },
    ]);
  }
  return record;
}

function buildVerifyUrl(
  config: MemberAuthRoutesConfig,
  _request: NextRequest,
  token: string,
): string {
  // Email-deliverable URL — strict siteUrl prevents Host-header
  // injection (#598). See `siteUrlStrict` doc comment for the
  // exploit path being closed.
  const url = new URL("/members/verify", siteUrlStrict(config));
  url.searchParams.set("token", token);
  return url.toString();
}

function buildResetUrl(
  config: MemberAuthRoutesConfig,
  _request: NextRequest,
  token: string,
): string {
  // Email-deliverable URL — strict siteUrl prevents Host-header
  // injection (#598). See `siteUrlStrict` doc comment.
  const url = new URL("/members/reset-password", siteUrlStrict(config));
  url.searchParams.set("token", token);
  return url.toString();
}

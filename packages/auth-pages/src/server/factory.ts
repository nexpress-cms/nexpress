import { randomBytes } from "node:crypto";

import {
  NpAuthError,
  NpForbiddenError,
  NpValidationError,
  consumeMemberEmailVerifyToken,
  consumeMemberPasswordReset,
  createMemberEmailVerifyToken,
  enqueueJob,
  getCommunitySettings,
  getLogger,
  getMemberFromTokenPayload,
  getOAuthProvider,
  hashPassword,
  invalidateAllMemberSessions,
  issueOAuthState,
  npMembers,
  npMemberSessions,
  requestMemberPasswordReset,
  resolveMemberOAuthLogin,
  sha256,
  signMemberToken,
  verifyMemberToken,
  verifyOAuthState,
  verifyPassword,
} from "@nexpress/core";
import { npErrorResponse, npSuccessResponse, readJsonBody } from "@nexpress/next";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NextResponse, type NextRequest } from "next/server";

import type {
  MemberAuthRoutes,
  MemberAuthRoutesConfig,
  MemberAuthRoutesOptions,
} from "./types.js";
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

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const STATE_COOKIE = "np-mb-oauth-state";
const STATE_COOKIE_MAX_AGE = 600;

const DEFAULTS = {
  login: { maxAttempts: 5, lockoutDurationMs: 15 * 60_000 },
  register: { minPasswordLength: 8 },
  resetPassword: { minPasswordLength: 8 },
  emailVerify: { tokenTtlMs: 24 * 60 * 60_000 },
  forgotPassword: { tokenTtlMs: 60 * 60_000 },
  oauth: { successRedirect: "/", failureRedirect: "/members/login" },
} as const;

function resolved(o: MemberAuthRoutesOptions = {}) {
  return {
    login: { ...DEFAULTS.login, ...o.login },
    register: { ...DEFAULTS.register, ...o.register },
    resetPassword: { ...DEFAULTS.resetPassword, ...o.resetPassword },
    emailVerify: { ...DEFAULTS.emailVerify, ...o.emailVerify },
    forgotPassword: { ...DEFAULTS.forgotPassword, ...o.forgotPassword },
    oauth: { ...DEFAULTS.oauth, ...o.oauth },
  };
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
        const lockoutSql = sql`case when ${npMembers.loginAttempts} + 1 >= ${opts.login.maxAttempts} then now() + interval '${sql.raw(String(opts.login.lockoutDurationMs))} milliseconds' else ${npMembers.lockUntil} end`;
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

      const { secret, tokenExpiration, refreshTokenExpiration } =
        authHelpers.getMemberAuthRuntimeConfig();
      const access = await signMemberToken(member, secret, tokenExpiration, "access");
      const refresh = await signMemberToken(member, secret, refreshTokenExpiration, "refresh");
      const csrf = randomBytes(16).toString("hex");

      const userAgent = request.headers.get("user-agent") ?? null;
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      await asDb(db).insert(npMemberSessions).values([
        {
          memberId: member.id,
          tokenHash: await sha256(access),
          userAgent,
          ip,
          expiresAt: new Date(Date.now() + tokenExpiration * 1000),
        },
        {
          memberId: member.id,
          tokenHash: await sha256(refresh),
          userAgent,
          ip,
          expiresAt: new Date(Date.now() + refreshTokenExpiration * 1000),
        },
      ]);

      const response = NextResponse.json(
        {
          member: {
            id: member.id,
            handle: member.handle,
            email: member.email,
            displayName: member.displayName,
          },
        },
        { status: 200 },
      );
      authHelpers.setMemberAuthCookies(response, { access, refresh, csrf });
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

      const body = validateRegisterBody(
        await readJsonBody(request),
        opts.register.minPasswordLength,
      );
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
        if (
          err instanceof Error &&
          "code" in err &&
          (err as { code?: string }).code === "23505"
        ) {
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
        siteName: config.site.name,
      });

      return npSuccessResponse({ ok: true });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── logout ─────────────────────────────────────────────────
  const logout = async (request: NextRequest): Promise<NextResponse> => {
    await ensureFor("read");
    const sessionToken = request.cookies.get("np-mb-session")?.value;
    const refreshToken = request.cookies.get("np-mb-refresh")?.value;

    const hashes: string[] = [];
    if (sessionToken) hashes.push(await sha256(sessionToken));
    if (refreshToken) hashes.push(await sha256(refreshToken));
    if (hashes.length > 0) {
      try {
        const db = getDb() as never;
        await asDb(db)
          .delete(npMemberSessions)
          .where(inArray(npMemberSessions.tokenHash, hashes));
      } catch {
        // Best-effort — cookies still clear below.
      }
    }

    const response = NextResponse.json({ ok: true }, { status: 200 });
    authHelpers.clearMemberAuthCookies(response);
    return response;
  };

  // ─── refresh ────────────────────────────────────────────────
  const refresh = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("read");
      const refreshToken = request.cookies.get("np-mb-refresh")?.value;
      if (!refreshToken) throw new NpAuthError();

      const { secret, tokenExpiration, refreshTokenExpiration } =
        authHelpers.getMemberAuthRuntimeConfig();
      const payload = await verifyMemberToken(refreshToken, secret, "refresh");
      const member = await getMemberFromTokenPayload(getDb() as never, payload);
      if (!member || member.status !== "active") throw new NpAuthError();

      const db = getDb() as never;
      const refreshHash = await sha256(refreshToken);
      const now = new Date();

      const [sessionRow] = await asDb(db)
        .select({ id: npMemberSessions.id })
        .from(npMemberSessions)
        .where(
          and(
            eq(npMemberSessions.memberId, member.id),
            eq(npMemberSessions.tokenHash, refreshHash),
            gt(npMemberSessions.expiresAt, now),
          ),
        )
        .limit(1);
      if (!sessionRow) throw new NpAuthError();

      const access = await signMemberToken(member, secret, tokenExpiration, "access");
      const refresh = await signMemberToken(member, secret, refreshTokenExpiration, "refresh");
      const csrf = randomBytes(16).toString("hex");

      const userAgent = request.headers.get("user-agent") ?? null;
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      await asDb(db).transaction(async (tx) => {
        await asDb(tx)
          .delete(npMemberSessions)
          .where(eq(npMemberSessions.id, sessionRow.id));
        await asDb(tx).insert(npMemberSessions).values([
          {
            memberId: member.id,
            tokenHash: await sha256(access),
            userAgent,
            ip,
            expiresAt: new Date(Date.now() + tokenExpiration * 1000),
          },
          {
            memberId: member.id,
            tokenHash: await sha256(refresh),
            userAgent,
            ip,
            expiresAt: new Date(Date.now() + refreshTokenExpiration * 1000),
          },
        ]);
      });

      const response = NextResponse.json(
        {
          member: {
            id: member.id,
            handle: member.handle,
            email: member.email,
            displayName: member.displayName,
          },
        },
        { status: 200 },
      );
      authHelpers.setMemberAuthCookies(response, { access, refresh, csrf });
      return response;
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  // ─── verify email ───────────────────────────────────────────
  const verifyEmail = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const body = (await readJsonBody(request)) as { token?: unknown } | null;
      const token = typeof body?.token === "string" ? body.token : "";
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
      const body = (await readJsonBody(request)) as { email?: unknown } | null;
      const email = typeof body?.email === "string" ? body.email : "";
      if (!email.includes("@")) {
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
      const body = (await readJsonBody(request)) as
        | { token?: unknown; password?: unknown }
        | null;
      const token = typeof body?.token === "string" ? body.token : "";
      const password = typeof body?.password === "string" ? body.password : "";
      if (password.length < opts.resetPassword.minPasswordLength) {
        throw new NpValidationError("Invalid input", [
          {
            field: "password",
            message: `Password must be at least ${opts.resetPassword.minPasswordLength} characters`,
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
    if (!provider) {
      return NextResponse.json(
        {
          error: { code: "NOT_FOUND", message: `OAuth provider "${providerId}" not registered` },
          status: 404,
        },
        { status: 404 },
      );
    }

    const { secret, secureCookies } = authHelpers.getMemberAuthRuntimeConfig();
    const { token, codeVerifier } = issueOAuthState(providerId, secret);
    const redirectUri = buildPath(
      config,
      request,
      `/api/members/oauth/${providerId}/callback`,
    );
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
      path: "/api/members/oauth",
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
        redirectUri: buildPath(
          config,
          request,
          `/api/members/oauth/${providerId}/callback`,
        ),
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
    const access = await signMemberToken(member, secret, tokenExpiration, "access");
    const refreshTok = await signMemberToken(member, secret, refreshTokenExpiration, "refresh");
    const csrf = randomBytes(16).toString("hex");

    const db = getDb() as never;
    const userAgent = request.headers.get("user-agent") ?? null;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await asDb(db).insert(npMemberSessions).values([
      {
        memberId: member.id,
        tokenHash: await sha256(access),
        userAgent,
        ip,
        expiresAt: new Date(Date.now() + tokenExpiration * 1000),
      },
      {
        memberId: member.id,
        tokenHash: await sha256(refreshTok),
        userAgent,
        ip,
        expiresAt: new Date(Date.now() + refreshTokenExpiration * 1000),
      },
    ]);

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
    authHelpers.setMemberAuthCookies(response, { access, refresh: refreshTok, csrf });
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
      return npSuccessResponse({ member: row });
    } catch (error) {
      return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
    }
  };

  const mePatch = async (request: NextRequest): Promise<NextResponse> => {
    try {
      await ensureFor("write");
      const member = await authHelpers.requireMember(request);
      const patch = validatePatchBody(
        await readJsonBody(request),
        opts.resetPassword.minPasswordLength,
      );
      const db = getDb() as never;

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.displayName !== undefined) updates.displayName = patch.displayName;
      if (patch.bio !== undefined) updates.bio = patch.bio;
      if (patch.avatar !== undefined) updates.avatar = patch.avatar;

      let mustReauth = false;
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
        updates.password = await hashPassword(patch.newPassword);
        mustReauth = true;
      }

      if (Object.keys(updates).length === 1) {
        return npSuccessResponse({ ok: true });
      }

      await asDb(db)
        .update(npMembers)
        .set(updates)
        .where(eq(npMembers.id, member.id));

      if (mustReauth) {
        await invalidateAllMemberSessions(db, member.id);
        const response = NextResponse.json({ ok: true, mustReauth: true }, { status: 200 });
        authHelpers.clearMemberAuthCookies(response);
        return response;
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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email.includes("@") || password.length === 0) {
    throw new NpValidationError("Invalid input", [
      { field: "credentials", message: "Email and password required" },
    ]);
  }
  return { email, password };
}

function validateRegisterBody(
  raw: unknown,
  minPasswordLength: number,
): { email: string; password: string; handle: string; displayName: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as Record<string, unknown>;
  const errors: Array<{ field: string; message: string }> = [];

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email.includes("@")) errors.push({ field: "email", message: "Valid email required" });

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < minPasswordLength) {
    errors.push({
      field: "password",
      message: `Password must be at least ${minPasswordLength} characters`,
    });
  }

  const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase() : "";
  if (!HANDLE_RE.test(handle)) {
    errors.push({
      field: "handle",
      message: "Handle must be 3–30 chars: lowercase letters, digits, underscore, dash",
    });
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (displayName.length === 0 || displayName.length > 80) {
    errors.push({ field: "displayName", message: "Display name 1–80 characters" });
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

function validatePatchBody(raw: unknown, minPasswordLength: number): PatchBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const body = raw as Record<string, unknown>;
  const out: PatchBody = {};
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || body.displayName.trim().length === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "displayName", message: "Display name must be a non-empty string" },
      ]);
    }
    out.displayName = body.displayName.trim().slice(0, 80);
  }
  if (body.bio !== undefined) {
    out.bio =
      body.bio === null
        ? null
        : typeof body.bio === "string"
          ? body.bio.slice(0, 500)
          : null;
  }
  if (body.avatar !== undefined) {
    out.avatar =
      body.avatar === null
        ? null
        : typeof body.avatar === "string"
          ? body.avatar
          : null;
  }
  if (body.newPassword !== undefined) {
    if (typeof body.newPassword !== "string" || body.newPassword.length < minPasswordLength) {
      throw new NpValidationError("Invalid input", [
        {
          field: "newPassword",
          message: `Password must be at least ${minPasswordLength} characters`,
        },
      ]);
    }
    if (typeof body.currentPassword !== "string" || body.currentPassword.length === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "currentPassword", message: "Current password required to change password" },
      ]);
    }
    out.newPassword = body.newPassword;
    out.currentPassword = body.currentPassword;
  }
  return out;
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

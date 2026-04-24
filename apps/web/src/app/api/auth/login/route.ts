import {
  NxAuthError,
  NxError,
  type NxUserRole,
  NxValidationError,
  runHook,
  signToken,
  verifyPassword,
} from "@nexpress/core";
import type { NextRequest } from "next/server";

import {
  getAuthRuntimeConfig,
  setAuthCookies,
} from "@/lib/auth-helpers";
import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { ensurePluginsLoaded } from "@/lib/init-core";

interface LoginUserRow extends Record<string, unknown> {
  id: string;
  email: string;
  password: string;
  name: string;
  role: NxUserRole;
  loginAttempts: number;
  lockUntil: Date | null;
  tokenVersion: number;
}

function validateLoginBody(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }

  const { email, password } = body as { email?: unknown; password?: unknown };

  if (typeof email !== "string" || !email.includes("@")) {
    throw new NxValidationError("Invalid input", [
      { field: "email", message: "Valid email is required" },
    ]);
  }

  if (typeof password !== "string" || password.length === 0) {
    throw new NxValidationError("Invalid input", [
      { field: "password", message: "Password is required" },
    ]);
  }

  return { email, password };
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = validateLoginBody(await request.json());
    const db = getDb();
    const config = getAuthRuntimeConfig();
    const result = await db.$client.query<LoginUserRow>(
      "select id, email, password, name, role, login_attempts as \"loginAttempts\", lock_until as \"lockUntil\", token_version as \"tokenVersion\" from nx_users where email = $1 limit 1",
      [email],
    );
    const user = result.rows[0];

    if (!user) {
      throw new NxAuthError("Invalid email or password");
    }

    const now = new Date();

    if (user.lockUntil && user.lockUntil > now) {
      throw new NxError("Too many login attempts", "TOO_MANY_REQUESTS", 429);
    }

    const validPassword = await verifyPassword(user.password, password);

    if (!validPassword) {
      const nextAttempts = user.loginAttempts + 1;
      const shouldLock = nextAttempts >= config.maxLoginAttempts;

      await db.$client.query(
        "update nx_users set login_attempts = $1, lock_until = $2, updated_at = $3 where id = $4",
        [
          nextAttempts,
          shouldLock ? new Date(now.getTime() + config.lockoutDuration * 1000) : null,
          now,
          user.id,
        ],
      );

      throw new NxAuthError("Invalid email or password");
    }

    await db.$client.query(
      "update nx_users set login_attempts = 0, lock_until = null, updated_at = $1 where id = $2",
      [now, user.id],
    );

    const access = await signToken(user, config.secret, config.tokenExpiration);
    const refresh = await signToken(user, config.secret, config.refreshTokenExpiration);
    const response = nxSuccessResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    setAuthCookies(response, {
      access,
      refresh,
      csrf: crypto.randomUUID(),
    });

    await ensurePluginsLoaded();
    await runHook("auth:afterLogin", {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });

    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

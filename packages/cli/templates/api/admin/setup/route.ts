import {
  NX_DEFAULT_SITE_ID,
  NxConflictError,
  NxValidationError,
  hashPassword,
  nxUsers,
  signToken,
  updateSite,
} from "@nexpress/core";
import { count, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { getAuthRuntimeConfig, setAuthCookies } from "@/lib/auth-helpers";
import { getDb } from "@/lib/bootstrap";

/**
 * First-boot Admin Setup endpoint. Allowed only when `nx_users` has
 * zero rows with `role = 'admin'`; once a real admin exists this
 * route returns 409 so a stale tab can't replay the install.
 *
 * Creates the first admin, optionally renames the default site,
 * issues an immediate session so the wizard hands the operator off
 * to /admin without a manual login round-trip.
 *
 * Sample-content seeding is intentionally NOT done here — the
 * shape of seed data depends on which collections this scaffold
 * declared. Operators run `pnpm seed:content` (or its own
 * equivalent) after finishing the wizard.
 */

interface SetupBody {
  email: string;
  password: string;
  name?: string;
  siteName?: string;
}

const PASSWORD_MIN = 12;

function validateBody(raw: unknown): SetupBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }
  const { email, password, name, siteName } = raw as Record<string, unknown>;
  const errors: Array<{ field: string; message: string }> = [];

  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: "email", message: "Valid email is required" });
  }
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    errors.push({
      field: "password",
      message: `Password must be at least ${PASSWORD_MIN.toString()} characters`,
    });
  }
  if (name !== undefined && typeof name !== "string") {
    errors.push({ field: "name", message: "Name must be a string" });
  }
  if (siteName !== undefined && typeof siteName !== "string") {
    errors.push({ field: "siteName", message: "Site name must be a string" });
  }
  if (errors.length > 0) {
    throw new NxValidationError("Invalid input", errors);
  }

  return {
    email: (email as string).trim(),
    password: password as string,
    ...(typeof name === "string" && name.trim().length > 0
      ? { name: name.trim() }
      : {}),
    ...(typeof siteName === "string" && siteName.trim().length > 0
      ? { siteName: siteName.trim() }
      : {}),
  };
}

async function adminCount(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(nxUsers)
    .where(eq(nxUsers.role, "admin"));
  return rows[0]?.value ?? 0;
}

export async function GET(): Promise<Response> {
  try {
    const existing = await adminCount();
    return nxSuccessResponse({ available: existing === 0 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = validateBody(await request.json());
    if ((await adminCount()) > 0) {
      throw new NxConflictError("Setup already completed");
    }

    const db = getDb();
    const passwordHash = await hashPassword(body.password);

    const existingEmail = await db
      .select({ id: nxUsers.id })
      .from(nxUsers)
      .where(eq(nxUsers.email, body.email))
      .limit(1);
    if (existingEmail[0]) {
      throw new NxConflictError("A user with that email already exists");
    }

    const [created] = await db
      .insert(nxUsers)
      .values({
        email: body.email,
        password: passwordHash,
        name: body.name ?? "Admin",
        role: "admin",
      })
      .returning({
        id: nxUsers.id,
        email: nxUsers.email,
        name: nxUsers.name,
        role: nxUsers.role,
        tokenVersion: nxUsers.tokenVersion,
      });
    if (!created) {
      throw new Error("Failed to create admin row");
    }

    if (body.siteName) {
      await updateSite(NX_DEFAULT_SITE_ID, { name: body.siteName });
    }

    const config = getAuthRuntimeConfig();
    const access = await signToken(
      created,
      config.secret,
      config.tokenExpiration,
      "access",
    );
    const refresh = await signToken(
      created,
      config.secret,
      config.refreshTokenExpiration,
      "refresh",
    );
    const response = nxSuccessResponse({
      user: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
      },
    });
    setAuthCookies(response, {
      access,
      refresh,
      csrf: crypto.randomUUID(),
    });
    return response;
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

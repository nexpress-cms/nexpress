/**
 * apps/web integration-test harness. Thin wrapper around the core integration
 * harness (`packages/core/src/integration/setup.ts`): same Postgres DB, same
 * migration runner, same truncate helper. This file adds the bits that are
 * app-side only — seeding users through the real auth hashing path, building
 * synthetic `NextRequest` objects with session + CSRF cookies, and parsing
 * responses.
 *
 * Tests SKIP themselves when `TEST_DATABASE_URL` isn't set so CI without a
 * Postgres can still run `pnpm test` and see the suite report as skipped.
 */

// eslint-disable-next-line import-x/no-relative-packages
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  getTestDatabaseUrl,
  skipIfNoTestDb,
  truncateAll,
} from "../../../packages/core/src/integration/setup.js";
// eslint-disable-next-line import-x/no-relative-packages
import { registerTestCollections } from "../../../packages/core/src/integration/fixtures.js";

import { hashPassword, nxUsers, signToken } from "@nexpress/core";
import { NextRequest } from "next/server";

import { ensureCoreServices } from "@/lib/init-core";

const TEST_JWT_SECRET = process.env.NX_SECRET as string;

export {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  getTestDatabaseUrl,
  skipIfNoTestDb,
  truncateAll,
  registerTestCollections,
};

export interface TestUserSession {
  userId: string;
  email: string;
  role: "admin" | "editor" | "moderator" | "author" | "viewer";
  accessToken: string;
  csrfToken: string;
}

/**
 * Seed a user and mint a valid access token for it. Bypasses `/api/auth/login`
 * because that path has its own middleware stack — these helpers exist to
 * test the downstream routes, not auth itself.
 */
export async function seedUser(
  overrides: Partial<{ email: string; password: string; name: string; role: TestUserSession["role"] }> = {},
): Promise<TestUserSession> {
  ensureCoreServices();
  const db = await getTestDb();
  const password = overrides.password ?? "password123456";
  const hash = await hashPassword(password);
  const [row] = await db
    .insert(nxUsers)
    .values({
      email: overrides.email ?? `user-${Date.now()}@example.com`,
      password: hash,
      name: overrides.name ?? "Test User",
      role: overrides.role ?? "admin",
    })
    .returning({
      id: nxUsers.id,
      email: nxUsers.email,
      role: nxUsers.role,
      tokenVersion: nxUsers.tokenVersion,
    });

  if (!row) throw new Error("Failed to seed user");

  const accessToken = await signToken(
    { id: row.id, role: row.role as TestUserSession["role"], tokenVersion: row.tokenVersion },
    TEST_JWT_SECRET,
  );
  const csrfToken = `csrf-${Math.random().toString(36).slice(2)}`;

  return {
    userId: row.id,
    email: row.email,
    role: row.role as TestUserSession["role"],
    accessToken,
    csrfToken,
  };
}

export interface RequestOptions {
  method?: string;
  session?: TestUserSession;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number>;
}

/**
 * Build a `NextRequest` matching how `middleware.ts` + `requireAuth` /
 * `requireCsrf` see incoming traffic: `nx-session` + `nx-csrf` cookies plus
 * the `X-CSRF-Token` header when a session is provided.
 */
export function buildRequest(path: string, options: RequestOptions = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.headers ?? {}),
  };
  const cookies: string[] = [];

  if (options.session) {
    cookies.push(`nx-session=${options.session.accessToken}`);
    cookies.push(`nx-csrf=${options.session.csrfToken}`);
    if (!headers["x-csrf-token"]) {
      headers["x-csrf-token"] = options.session.csrfToken;
    }
  }
  if (cookies.length > 0) {
    headers.cookie = cookies.join("; ");
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };
  if (options.body !== undefined) {
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  return new NextRequest(url, init);
}

/**
 * Response helper — reads a JSON body once and exposes status + parsed body
 * so tests can assert on both without fiddling with streams.
 */
export async function readJson<T = unknown>(response: Response): Promise<{ status: number; body: T }> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : (null as T);
  return { status: response.status, body };
}

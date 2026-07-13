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

import {
  createMemberSession,
  createStaffSession,
  hashPassword,
  npMembers,
  npUsers,
} from "@nexpress/core";
import type { NpUserRole } from "@nexpress/core/auth-contract";
import { NextRequest } from "next/server";

import { ensureFor } from "@/lib/init-core";

const TEST_JWT_SECRET = process.env.NP_SECRET as string;

export {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  getTestDatabaseUrl,
  skipIfNoTestDb,
  truncateAll,
  registerTestCollections,
};

/**
 * Speedup A — Argon2 is intentionally slow (~30ms / hash on a
 * dev laptop). Test seeds use the same default password every
 * call, so we hash it ONCE per worker and reuse the digest for
 * every subsequent seed. Tests that need a different password
 * still pass `overrides.password` and pay the per-call hash
 * cost; that's the rare branch.
 */
const DEFAULT_TEST_PASSWORD = "password123456";
let cachedDefaultHash: string | null = null;
async function getDefaultPasswordHash(): Promise<string> {
  if (cachedDefaultHash !== null) return cachedDefaultHash;
  cachedDefaultHash = await hashPassword(DEFAULT_TEST_PASSWORD);
  return cachedDefaultHash;
}

export interface TestUserSession {
  userId: string;
  email: string;
  name: string;
  role: NpUserRole;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

/**
 * Seed a user and mint a valid access token for it. Bypasses `/api/auth/login`
 * because that path has its own middleware stack — these helpers exist to
 * test the downstream routes, not auth itself.
 *
 * Speedup A — uses the shared default-password hash when the
 * caller doesn't override it, so 100+ tests don't each pay
 * Argon2's ~30ms cost.
 */
export async function seedUser(
  overrides: Partial<{
    email: string;
    password: string;
    name: string;
    role: TestUserSession["role"];
  }> = {},
): Promise<TestUserSession> {
  await ensureFor("read");
  const db = await getTestDb();
  const hash = overrides.password
    ? await hashPassword(overrides.password)
    : await getDefaultPasswordHash();
  const [row] = await db
    .insert(npUsers)
    .values({
      email:
        overrides.email ??
        `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: hash,
      name: overrides.name ?? "Test User",
      role: overrides.role ?? "admin",
    })
    .returning({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    });

  if (!row) throw new Error("Failed to seed user");

  const session = await createStaffSession(
    {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      tokenVersion: row.tokenVersion,
    },
    TEST_JWT_SECRET,
    db,
    { accessExpiration: 7200, refreshExpiration: 604800 },
  );
  const csrfToken = `csrf-${Math.random().toString(36).slice(2)}`;

  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    accessToken: session.access,
    refreshToken: session.refresh,
    csrfToken,
  };
}

export interface TestMemberSession {
  memberId: string;
  email: string;
  handle: string;
  sessionCookie: string;
  refreshCookie: string;
  csrfCookie: string;
}

/**
 * Speedup A — direct-insert member seed. Replaces the
 * register → verify → login endpoint chain that was duplicated
 * across most member-touching test files (~6 DB writes + 2
 * Argon2 ops + 3 route invocations). This helper:
 *
 *   1. Inserts the `np_members` row directly with the cached
 *      default-password hash and `status='active' / emailVerified=true`.
 *   2. Calls `createMemberSession`, the same paired-token/session-row
 *      primitive used by password and OAuth login.
 *
 * The result is a session object the existing `memberRequest`
 * helpers can stamp into cookies as if the member had logged
 * in normally. Tests that specifically exercise the
 * register / verify / login flow keep using the endpoints; we
 * only short-circuit "I just need a logged-in member."
 */
export async function seedActiveMember(
  overrides: Partial<{
    handle: string;
    email: string;
    displayName: string;
  }> = {},
): Promise<TestMemberSession> {
  await ensureFor("read");
  const db = await getTestDb();
  const handle =
    overrides.handle ??
    `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
  const email = overrides.email ?? `${handle}@example.com`;
  const displayName = overrides.displayName ?? handle;
  const hash = await getDefaultPasswordHash();

  const [memberRow] = (await db
    .insert(npMembers)
    .values({
      email,
      password: hash,
      handle,
      displayName,
      emailVerified: true,
      status: "active",
    })
    .returning({
      id: npMembers.id,
      handle: npMembers.handle,
      email: npMembers.email,
      displayName: npMembers.displayName,
      status: npMembers.status,
      tokenVersion: npMembers.tokenVersion,
    })) as Array<{
    id: string;
    handle: string;
    email: string;
    displayName: string;
    status: "active";
    tokenVersion: number;
  }>;

  if (!memberRow) throw new Error("Failed to seed member");

  const session = await createMemberSession(
    {
      id: memberRow.id,
      email: memberRow.email,
      handle: memberRow.handle,
      displayName: memberRow.displayName,
      status: memberRow.status,
      tokenVersion: memberRow.tokenVersion,
    },
    TEST_JWT_SECRET,
    db,
    { accessExpiration: 7200, refreshExpiration: 604800 },
  );

  const csrfCookie = `csrf-${Math.random().toString(36).slice(2)}`;

  return {
    memberId: memberRow.id,
    email: memberRow.email,
    handle: memberRow.handle,
    sessionCookie: session.access,
    refreshCookie: session.refresh,
    csrfCookie,
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
 * `requireCsrf` see incoming traffic: `np-session` + `np-csrf` cookies plus
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
    cookies.push(`np-session=${options.session.accessToken}`);
    cookies.push(`np-csrf=${options.session.csrfToken}`);
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
export async function readJson<T = unknown>(
  response: Response,
): Promise<{ status: number; body: T }> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : (null as T);
  return { status: response.status, body };
}

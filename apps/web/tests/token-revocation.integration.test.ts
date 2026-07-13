/**
 * Phase 23.4 — multi-instance token revocation verification.
 *
 * Confirms that bumping `tokenVersion` on instance A causes instance
 * B's next `verifyTokenFull` call to reject the previously-issued
 * JWT. The mechanism is documented in AGENTS.md ("sessions have a
 * `tokenVersion` that can be bumped to invalidate") and used by
 * `invalidateAllSessions` for forced sign-out, but until now no test
 * exercised the multi-instance path under load.
 *
 * "Multi-instance" is simulated by holding two independent
 * `NodePgDatabase` connections to the same Postgres database — the
 * source of truth for `tokenVersion` is the row in `np_users`, so any
 * instance reading the row after the bump sees the new value. Two
 * connections make the intent explicit; the assertion would still
 * hold with one connection because Postgres is what synchronizes the
 * decision, not the in-process connection pool.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import {
  createStaffSession,
  createDbConnection,
  invalidateAllSessions,
  npSessions,
  sha256,
  signToken,
  verifyTokenFull,
} from "@nexpress/core";
import { eq } from "drizzle-orm";

describe.skipIf(skipIfNoTestDb())("token revocation across instances (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects a stale JWT on instance B after instance A bumps tokenVersion", async () => {
    const secret = process.env.NP_SECRET as string;
    // Two independent pools simulate two app processes behind a load
    // balancer. Both point at the same Postgres.
    const instanceA = createDbConnection({ connectionString: getTestDatabaseUrl() });
    const instanceB = createDbConnection({ connectionString: getTestDatabaseUrl() });

    const session = await seedUser({ email: "revoke@example.com", role: "admin" });

    // Sanity — instance B accepts the token before any bump.
    const beforeBump = await verifyTokenFull(session.accessToken, secret, instanceB);
    expect(beforeBump).not.toBeNull();
    expect(beforeBump?.id).toBe(session.userId);

    // Operator forces sign-out on instance A (e.g. compromised account).
    await invalidateAllSessions(session.userId, instanceA);

    // Instance B's next verify reads the new tokenVersion from
    // Postgres and refuses the JWT. Without this contract a
    // compromised account would still be reachable through any
    // instance that hadn't seen the bump locally.
    const afterBump = await verifyTokenFull(session.accessToken, secret, instanceB);
    expect(afterBump).toBeNull();
  });

  it("accepts a freshly-signed JWT issued post-bump on instance B", async () => {
    const secret = process.env.NP_SECRET as string;
    const instanceA = createDbConnection({ connectionString: getTestDatabaseUrl() });
    const instanceB = createDbConnection({ connectionString: getTestDatabaseUrl() });

    const session = await seedUser({ email: "revoke2@example.com", role: "editor" });

    await invalidateAllSessions(session.userId, instanceA);

    // After the bump the user re-authenticates and gets a JWT
    // signed against the new tokenVersion. Instance B must accept
    // it — otherwise the bump locks the user out permanently
    // instead of just invalidating outstanding tokens.
    const newSession = await createStaffSession(
      {
        id: session.userId,
        email: session.email,
        name: session.name,
        role: session.role,
        tokenVersion: 1,
      },
      secret,
      instanceA,
      { accessExpiration: 7200, refreshExpiration: 604800 },
    );
    const verified = await verifyTokenFull(newSession.access, secret, instanceB);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(session.userId);
  });

  it("rejects a JWT minted with a stale tokenVersion even when the matching token-version row exists", async () => {
    // Defends against a confused-deputy bug where an attacker who
    // observed an old tokenVersion (e.g. via DB read replica lag)
    // could mint a JWT against it and have the server accept it
    // because the version matched at sign time. The verify path
    // re-reads the *current* tokenVersion at request time, so a
    // pre-bump observation can't be replayed after the bump lands.
    const secret = process.env.NP_SECRET as string;
    const db = await getTestDb();

    const session = await seedUser({ email: "revoke3@example.com", role: "admin" });
    await invalidateAllSessions(session.userId, db);

    // Attacker mints a JWT against the *old* tokenVersion (0). The
    // signature is valid; the server still rejects because the
    // current row says tokenVersion=1.
    const currentSession = await createStaffSession(
      {
        id: session.userId,
        email: session.email,
        name: session.name,
        role: session.role,
        tokenVersion: 1,
      },
      secret,
      db,
      { accessExpiration: 7200, refreshExpiration: 604800 },
    );
    const replayedToken = await signToken(
      { id: session.userId, tokenVersion: 0 },
      secret,
      7200,
      "access",
      currentSession.sessionId,
    );
    await db
      .update(npSessions)
      .set({ accessTokenHash: await sha256(replayedToken) })
      .where(eq(npSessions.id, currentSession.sessionId));
    const verified = await verifyTokenFull(replayedToken, secret, db);
    expect(verified).toBeNull();
  });
});

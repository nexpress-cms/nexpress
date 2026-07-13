import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  consumeMemberPasswordReset,
  requestMemberPasswordReset,
} from "../auth/member-credentials.js";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  requestPasswordReset,
} from "../auth/reset-token.js";
import { npMembers } from "../db/schema/community.js";
import { npSessions, npUsers } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";

describe.skipIf(skipIfNoTestDb())("password reset token (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedUser(email = "alice@example.com", password = "originalpassword") {
    const db = await getTestDb();
    const hash = await hashPassword(password);
    const [row] = await db
      .insert(npUsers)
      .values({
        email,
        password: hash,
        name: "Alice",
        role: "editor",
      })
      .returning();
    return row;
  }

  it("requestPasswordReset returns the user's name + email for a known address", async () => {
    const db = await getTestDb();
    await seedUser("bob@example.com");

    const result = await requestPasswordReset(db, "BOB@example.com", 60_000);
    expect(result.userId).not.toBeNull();
    expect(result.email).toBe("bob@example.com");
    expect(result.name).toBe("Alice");
    expect(result.issued?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.issued?.expiresAt).toBeInstanceOf(Date);
  });

  it("requestPasswordReset is silent for unknown emails", async () => {
    const db = await getTestDb();
    const result = await requestPasswordReset(db, "ghost@example.com", 60_000);
    expect(result).toEqual({ userId: null, name: null, email: null, issued: null });
  });

  it("consumePasswordResetToken updates password + bumps tokenVersion + deletes sessions", async () => {
    const db = await getTestDb();
    const user = await seedUser();

    // Seed a fake active session to prove it gets cleared.
    const now = new Date();
    await db.insert(npSessions).values({
      userId: user.id,
      accessTokenHash: "a".repeat(64),
      refreshTokenHash: "b".repeat(64),
      accessExpiresAt: new Date(now.valueOf() + 60_000),
      refreshExpiresAt: new Date(now.valueOf() + 120_000),
      createdAt: now,
      updatedAt: now,
    });

    const issued = await createPasswordResetToken(db, {
      userId: user.id,
      purpose: "reset",
      ttlMs: 60_000,
    });

    const result = await consumePasswordResetToken(db, {
      token: issued.token,
      newPassword: "brandnewpassword",
    });
    expect(result.userId).toBe(user.id);
    expect(result.purpose).toBe("reset");

    const [after] = await db.select().from(npUsers).where(eq(npUsers.id, user.id));
    expect(after.tokenVersion).toBe(user.tokenVersion + 1);
    expect(after.passwordResetTokenHash).toBeNull();
    expect(after.passwordResetExpiresAt).toBeNull();
    expect(after.passwordResetPurpose).toBeNull();
    expect(await verifyPassword(after.password, "brandnewpassword")).toBe(true);
    expect(await verifyPassword(after.password, "originalpassword")).toBe(false);

    const sessions = await db.select().from(npSessions).where(eq(npSessions.userId, user.id));
    expect(sessions).toHaveLength(0);
  });

  it("consumePasswordResetToken rejects an expired token", async () => {
    const db = await getTestDb();
    const user = await seedUser();

    const issued = await createPasswordResetToken(db, {
      userId: user.id,
      purpose: "reset",
      ttlMs: 60_000,
    });
    await db
      .update(npUsers)
      .set({ passwordResetExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(npUsers.id, user.id));

    await expect(
      consumePasswordResetToken(db, { token: issued.token, newPassword: "brandnewpassword" }),
    ).rejects.toBeInstanceOf(NpValidationError);
  });

  it("consumePasswordResetToken rejects an unknown token without touching the user", async () => {
    const db = await getTestDb();
    const user = await seedUser();

    await expect(
      consumePasswordResetToken(db, {
        token: "0".repeat(64),
        newPassword: "brandnewpassword",
      }),
    ).rejects.toBeInstanceOf(NpValidationError);

    const [after] = await db.select().from(npUsers).where(eq(npUsers.id, user.id));
    expect(after.tokenVersion).toBe(user.tokenVersion);
    expect(after.password).toBe(user.password);
  });

  it("compare-and-swap consumes a staff reset token only once under concurrency", async () => {
    const db = await getTestDb();
    const user = await seedUser();
    const issued = await createPasswordResetToken(db, {
      userId: user.id,
      purpose: "reset",
      ttlMs: 60_000,
    });

    const results = await Promise.allSettled([
      consumePasswordResetToken(db, {
        token: issued.token,
        newPassword: "firstconcurrentpassword",
      }),
      consumePasswordResetToken(db, {
        token: issued.token,
        newPassword: "secondconcurrentpassword",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [after] = await db.select().from(npUsers).where(eq(npUsers.id, user.id));
    expect(after.tokenVersion).toBe(user.tokenVersion + 1);
  });

  it("compare-and-swap consumes a member reset token only once under concurrency", async () => {
    const db = await getTestDb();
    const password = await hashPassword("originalpassword");
    const [member] = await db
      .insert(npMembers)
      .values({
        email: "member@example.com",
        password,
        handle: "member_one",
        displayName: "Member One",
        status: "active",
      })
      .returning();
    const requested = await requestMemberPasswordReset(db, member.email, 60_000);
    if (!requested.issued) throw new Error("Expected member reset token");

    const results = await Promise.allSettled([
      consumeMemberPasswordReset(db, requested.issued.token, "firstconcurrentpassword"),
      consumeMemberPasswordReset(db, requested.issued.token, "secondconcurrentpassword"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [after] = await db.select().from(npMembers).where(eq(npMembers.id, member.id));
    expect(after.tokenVersion).toBe(member.tokenVersion + 1);
  });
});

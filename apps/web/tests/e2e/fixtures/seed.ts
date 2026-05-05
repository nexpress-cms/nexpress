/**
 * E2E fixture seed (Phase 23.6).
 *
 * Creates a known-good admin user the spec files can sign in as.
 * Idempotent — re-running keeps the existing row, swapping the
 * password if it drifted. The fixture writes via the same Drizzle
 * connection the app uses; we don't go through the public API
 * because the API requires CSRF + a logged-in admin to create
 * other admins, which is the bootstrap chicken-and-egg this
 * file exists to break.
 */

import { eq } from "drizzle-orm";

import { createDbConnection, hashPassword, npUsers } from "@nexpress/core";

export const E2E_ADMIN = {
  email: "e2e-admin@example.com",
  password: "e2e-test-password-1234",
  name: "E2E Admin",
};

export async function seedE2EAdmin(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — Playwright cannot seed the e2e admin.");
  }
  const db = createDbConnection({ connectionString: databaseUrl });
  const passwordHash = await hashPassword(E2E_ADMIN.password);

  const [existing] = await db
    .select({ id: npUsers.id })
    .from(npUsers)
    .where(eq(npUsers.email, E2E_ADMIN.email))
    .limit(1);

  if (existing) {
    // Refresh password + role + name and explicitly clear the
    // lockout counter / lock_until so a previous run that tripped
    // brute-force protection doesn't leave the next run unable to
    // sign in. Without the reset the spec randomly 401s after a
    // failed-password test runs first.
    await db
      .update(npUsers)
      .set({
        password: passwordHash,
        role: "admin",
        name: E2E_ADMIN.name,
        loginAttempts: 0,
        lockUntil: null,
      })
      .where(eq(npUsers.id, existing.id));
    return;
  }

  await db.insert(npUsers).values({
    email: E2E_ADMIN.email,
    password: passwordHash,
    name: E2E_ADMIN.name,
    role: "admin",
  });
}

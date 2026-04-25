/**
 * Runs before every test file's module resolution. Must set any env vars
 * that modules read at import time — `nexpress.config.ts` validates
 * `NX_SECRET` when evaluated, and the bootstrap helper reads
 * `DATABASE_URL` the first time a route handler hits the DB.
 *
 * Pointing `DATABASE_URL` at `TEST_DATABASE_URL` lets the app-side bootstrap
 * pool and the test harness pool both target the same test database, so
 * writes done via route handlers are visible to direct-SQL assertions and
 * vice-versa.
 */
if (!process.env.NX_SECRET) {
  process.env.NX_SECRET = "test-secret-for-integration-tests-only-32ch";
}
if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

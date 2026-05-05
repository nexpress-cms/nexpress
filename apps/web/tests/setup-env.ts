/**
 * Runs before every test file's module resolution. Must set any env vars
 * that modules read at import time — `nexpress.config.ts` validates
 * `NP_SECRET` when evaluated, and the bootstrap helper reads
 * `DATABASE_URL` the first time a route handler hits the DB.
 *
 * Pointing `DATABASE_URL` at the per-worker test DB lets the app-side
 * bootstrap pool and the test harness pool both target the same database,
 * so writes done via route handlers are visible to direct-SQL assertions
 * and vice-versa. We always overwrite when TEST_DATABASE_URL is set —
 * otherwise a `.env` that ships a dev DATABASE_URL alongside
 * TEST_DATABASE_URL would leave the route-handler pool pointed at the
 * dev DB. The `_wN` suffix mirrors getTestDatabaseUrl() in the core
 * integration setup so harness + bootstrap land on the same DB.
 */
if (!process.env.NP_SECRET) {
  process.env.NP_SECRET = "test-secret-for-integration-tests-only-32ch";
}
if (process.env.TEST_DATABASE_URL) {
  const u = new URL(process.env.TEST_DATABASE_URL);
  const id = process.env.VITEST_POOL_ID;
  if (id) {
    const base = u.pathname.replace(/^\//, "");
    u.pathname = `/${base}_w${id}`;
  }
  process.env.DATABASE_URL = u.toString();
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}
// Drops argon2 hashing from ~75ms to <1ms per call. seedUser fires this
// 287×/run; the speed-up matters and the weakened params never leak out
// of the test process.
process.env.NP_TEST_FAST_HASH = "1";

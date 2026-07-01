import { afterEach, describe, expect, it } from "vitest";

import { getTestDatabaseUrl } from "./setup.js";

const originalEnv = {
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  VITEST_POOL_ID: process.env.VITEST_POOL_ID,
  NP_TEST_DB_RUN_ID: process.env.NP_TEST_DB_RUN_ID,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("integration test database URL helpers", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("returns null when TEST_DATABASE_URL is unset", () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.VITEST_POOL_ID;
    delete process.env.NP_TEST_DB_RUN_ID;

    expect(getTestDatabaseUrl()).toBeNull();
  });

  it("preserves the legacy worker suffix when no run namespace is assigned", () => {
    process.env.TEST_DATABASE_URL = "postgres://u:p@localhost:5433/nexpress_test";
    process.env.VITEST_POOL_ID = "3";
    delete process.env.NP_TEST_DB_RUN_ID;

    expect(getTestDatabaseUrl()).toBe("postgres://u:p@localhost:5433/nexpress_test_w3");
  });

  it("adds the run namespace before the worker suffix", () => {
    process.env.TEST_DATABASE_URL = "postgres://u:p@localhost:5433/nexpress_test";
    process.env.VITEST_POOL_ID = "2";
    process.env.NP_TEST_DB_RUN_ID = "rabc123";

    expect(getTestDatabaseUrl()).toBe("postgres://u:p@localhost:5433/nexpress_test_rabc123_w2");
  });

  it("uses a namespaced single-worker database when Vitest has no pool id", () => {
    process.env.TEST_DATABASE_URL = "postgres://u:p@localhost:5433/nexpress_test";
    delete process.env.VITEST_POOL_ID;
    process.env.NP_TEST_DB_RUN_ID = "rabc123";

    expect(getTestDatabaseUrl()).toBe("postgres://u:p@localhost:5433/nexpress_test_rabc123_single");
  });

  it("keeps long generated database names within Postgres' identifier limit", () => {
    process.env.TEST_DATABASE_URL =
      "postgres://u:p@localhost:5433/nexpress_really_long_project_name_that_would_overflow_the_identifier_limit_test";
    process.env.VITEST_POOL_ID = "17";
    process.env.NP_TEST_DB_RUN_ID = "rabc123";

    const url = getTestDatabaseUrl();
    expect(url).not.toBeNull();
    const name = new URL(url ?? "").pathname.replace(/^\//, "");
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name.endsWith("_rabc123_w17")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { messageForConnectionError } from "@nexpress/app/scripts/setup-server-errors";

const TEST_URL = "postgres://nexpress:nexpress@localhost:5433/mysite";

function withCode(code: string, message = "boom"): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

describe("messageForConnectionError", () => {
  it("3D000 mentions the exact psql CREATE DATABASE line for this URL", () => {
    const msg = messageForConnectionError(TEST_URL, withCode("3D000"));
    expect(msg).toContain('Database "mysite" does not exist');
    expect(msg).toContain("psql -h localhost -p 5433 -U nexpress");
    expect(msg).toContain('CREATE DATABASE "mysite"');
    // Docker recovery hint stays — covers the operator who's using
    // the scaffold's docker-compose and just needs to rebuild the
    // volume.
    expect(msg).toContain("docker compose -f docker/docker-compose.yml up -d db");
  });

  it("28P01 frames the failure as a port-collision and offers two fixes", () => {
    const msg = messageForConnectionError(TEST_URL, withCode("28P01"));
    expect(msg).toContain('Authentication failed for user "nexpress"');
    expect(msg).toContain("localhost:5433");
    expect(msg).toContain("different Postgres instance");
    expect(msg).toContain("silently no-op");
    // Both remediation paths surface so the operator can pick.
    expect(msg).toContain("Stop the conflicting service");
    expect(msg).toContain("NEXPRESS_DB_PORT");
  });

  it("28000 uses the same port-collision shape as 28P01", () => {
    const msg = messageForConnectionError(TEST_URL, withCode("28000"));
    expect(msg).toContain("28000");
    expect(msg).toContain("different Postgres instance");
    expect(msg).toContain("NEXPRESS_DB_PORT");
  });

  it("28P01 with suggestedPort appends a concrete recommendation", () => {
    const msg = messageForConnectionError(TEST_URL, withCode("28P01"), {
      suggestedPort: 5601,
    });
    expect(msg).toContain("Detected free port: 5601");
    expect(msg).toContain("NEXPRESS_DB_PORT=5601");
    expect(msg).toContain(":5601/mysite");
  });

  it("28P01 without suggestedPort emits the base message (no detected-port line)", () => {
    const msg = messageForConnectionError(TEST_URL, withCode("28P01"));
    expect(msg).not.toContain("Detected free port");
  });

  it("28P01 with null / non-positive suggestedPort is treated as absent", () => {
    const a = messageForConnectionError(TEST_URL, withCode("28P01"), {
      suggestedPort: null,
    });
    const b = messageForConnectionError(TEST_URL, withCode("28P01"), {
      suggestedPort: 0,
    });
    expect(a).not.toContain("Detected free port");
    expect(b).not.toContain("Detected free port");
  });

  it("ECONNREFUSED tells the operator to start the docker-compose db", () => {
    const msg = messageForConnectionError(TEST_URL, withCode("ECONNREFUSED"));
    expect(msg).toContain("Nothing is listening on localhost:5433");
    expect(msg).toContain("docker compose -f docker/docker-compose.yml up -d db");
  });

  it("falls back to the raw error message for unknown pg codes", () => {
    const err = withCode("XX000", "something went very wrong");
    const msg = messageForConnectionError(TEST_URL, err);
    expect(msg).toBe("something went very wrong");
  });

  it("falls back to the raw error message when there is no code at all", () => {
    const msg = messageForConnectionError(TEST_URL, new Error("plain failure"));
    expect(msg).toBe("plain failure");
  });

  it("survives an unparseable DATABASE_URL by using placeholder host/port", () => {
    const msg = messageForConnectionError("not-a-url", withCode("3D000"));
    // dbName / host / port fall back to "<db>" / "localhost" / "5432"
    // so the operator at least sees a runnable shape.
    expect(msg).toContain('Database "<db>"');
    expect(msg).toContain("localhost");
    expect(msg).toContain("5432");
  });
});

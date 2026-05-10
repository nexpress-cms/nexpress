import { describe, expect, it } from "vitest";

import { validateBody } from "@/../scripts/setup-server";

const ok = (body: Parameters<typeof validateBody>[0]) => {
  const out = validateBody(body);
  if ("error" in out) {
    throw new Error(`expected ok, got error: ${out.error}`);
  }
  return out.body;
};

const err = (body: Parameters<typeof validateBody>[0]): string => {
  const out = validateBody(body);
  if (!("error" in out)) {
    throw new Error("expected error, got ok");
  }
  return out.error;
};

const baseValid = {
  databaseUrl: "postgres://nexpress:nexpress@localhost:5432/nexpress",
  npSecret: "abcdefghABCDEFGH01234567ABCDEFGH",
  siteUrl: "https://example.com",
  storage: "local" as const,
};

describe("setup-server validateBody", () => {
  it("accepts a well-formed payload", () => {
    const out = ok(baseValid);
    expect(out.databaseUrl).toBe(baseValid.databaseUrl);
    expect(out.npSecret).toBe(baseValid.npSecret);
    expect(out.siteUrl).toBe(baseValid.siteUrl);
  });

  // ── DATABASE_URL ─────────────────────────────────────────────

  it("rejects DATABASE_URL with the wrong protocol", () => {
    expect(err({ ...baseValid, databaseUrl: "mysql://x:y@h/db" })).toMatch(
      /must start with postgres/,
    );
  });

  it("accepts the postgresql:// alias alongside postgres://", () => {
    ok({
      ...baseValid,
      databaseUrl: "postgresql://nexpress:nexpress@localhost:5432/nexpress",
    });
  });

  it("rejects DATABASE_URL with no host (e.g. `postgres://`)", () => {
    expect(err({ ...baseValid, databaseUrl: "postgres://" })).toMatch(
      /missing the host portion/,
    );
  });

  it("rejects DATABASE_URL that doesn't parse as URL", () => {
    expect(
      err({ ...baseValid, databaseUrl: "postgres://[malformed" }),
    ).toMatch(/not a valid URL/);
  });

  // ── NP_SECRET ─────────────────────────────────────────────────

  it("rejects NP_SECRET shorter than 32 chars", () => {
    expect(err({ ...baseValid, npSecret: "short" })).toMatch(
      /at least 32 characters/,
    );
  });

  it("rejects low-entropy NP_SECRET (single char repeated 32×)", () => {
    expect(err({ ...baseValid, npSecret: "a".repeat(32) })).toMatch(
      /low-entropy/,
    );
  });

  it("rejects low-entropy NP_SECRET (only 7 distinct chars)", () => {
    // 32 chars, 7 distinct chars (`abcdefg` x4 + 4 padding `a`s)
    expect(err({ ...baseValid, npSecret: "abcdefgabcdefgabcdefgabcdefgaaaa" })).toMatch(
      /low-entropy/,
    );
  });

  it("accepts NP_SECRET with 8+ distinct chars at min length", () => {
    // exactly 8 distinct: a,b,c,d,e,f,g,h
    ok({ ...baseValid, npSecret: "abcdefghabcdefghabcdefghabcdefgh" });
  });

  // ── SITE_URL ──────────────────────────────────────────────────

  it("rejects SITE_URL with the wrong protocol", () => {
    expect(err({ ...baseValid, siteUrl: "ftp://example.com" })).toMatch(
      /must start with http/,
    );
  });

  it("rejects SITE_URL with no host (e.g. `https://`)", () => {
    // `new URL("https://")` throws — caught by the try/catch and
    // surfaced as "not a valid URL". Either error message is fine
    // for the operator; both point at the host portion.
    expect(err({ ...baseValid, siteUrl: "https://" })).toMatch(
      /not a valid URL|missing the host portion/,
    );
  });

  it("rejects SITE_URL that's just whitespace", () => {
    expect(err({ ...baseValid, siteUrl: "   " })).toMatch(
      /must start with http/,
    );
  });

  it("rejects SITE_URL that doesn't parse as URL", () => {
    expect(err({ ...baseValid, siteUrl: "https://[malformed" })).toMatch(
      /not a valid URL/,
    );
  });

  // ── S3 storage ────────────────────────────────────────────────

  it("rejects storage=s3 with no bucket", () => {
    expect(
      err({ ...baseValid, storage: "s3", s3Region: "us-east-1" }),
    ).toMatch(/bucket is required/);
  });

  it("rejects storage=s3 with no region", () => {
    expect(err({ ...baseValid, storage: "s3", s3Bucket: "media" })).toMatch(
      /region is required/,
    );
  });

  it("accepts storage=s3 with bucket + region (no endpoint)", () => {
    const out = ok({
      ...baseValid,
      storage: "s3",
      s3Bucket: "media",
      s3Region: "us-east-1",
    });
    expect(out.storage).toBe("s3");
    expect(out.s3Endpoint).toBeUndefined();
  });

  it("rejects malformed S3 endpoint when supplied", () => {
    expect(
      err({
        ...baseValid,
        storage: "s3",
        s3Bucket: "media",
        s3Region: "us-east-1",
        s3Endpoint: "https://[malformed",
      }),
    ).toMatch(/S3 endpoint is not a valid URL/);
  });

  it("accepts well-formed S3 endpoint", () => {
    ok({
      ...baseValid,
      storage: "s3",
      s3Bucket: "media",
      s3Region: "us-east-1",
      s3Endpoint: "https://minio.example.com",
    });
  });

  // ── runMigrate default ────────────────────────────────────────

  it("defaults runMigrate to true when omitted", () => {
    const out = ok(baseValid);
    expect(out.runMigrate).toBe(true);
  });

  it("preserves runMigrate=false when explicitly set", () => {
    const out = ok({ ...baseValid, runMigrate: false });
    expect(out.runMigrate).toBe(false);
  });
});

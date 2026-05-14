/**
 * Validation for the setup wizard's form submission. Extracted into
 * its own module so unit tests can exercise it without booting the
 * HTTP server (importing setup-server.ts triggers `createServer` at
 * module top level by design — it's an entrypoint script).
 */

export interface SetupBody {
  databaseUrl: string;
  testDatabaseUrl?: string;
  npSecret: string;
  siteUrl: string;
  storage: "local" | "s3";
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  runMigrate: boolean;
}

export function validateBody(
  raw: Partial<SetupBody>,
): { body: SetupBody } | { error: string } {
  const databaseUrl = (raw.databaseUrl ?? "").trim();
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    return { error: "DATABASE_URL must start with postgres:// or postgresql://" };
  }
  // Parse beyond the protocol prefix — catches `postgres://` (no
  // host) and similar shapes that the regex accepts but the pg
  // connector would crash on at first use.
  let dbHost: string | null = null;
  try {
    dbHost = new URL(databaseUrl).hostname || null;
  } catch {
    return { error: "DATABASE_URL is not a valid URL — check the host/port portion" };
  }
  if (!dbHost) {
    return { error: "DATABASE_URL is missing the host portion" };
  }

  const npSecret = (raw.npSecret ?? "").trim();
  if (npSecret.length < 32) {
    return { error: "NP_SECRET must be at least 32 characters" };
  }
  // Reject low-entropy secrets — a 32-char string that's a single
  // repeated character passes the length check but is trivially
  // guessable. The form's `generate` button produces a real
  // 64-char random hex; this catches the operator who overwrites
  // that with something memorable.
  const uniqueChars = new Set(npSecret).size;
  if (uniqueChars < 8) {
    return {
      error:
        "NP_SECRET is too low-entropy (only " +
        String(uniqueChars) +
        " distinct chars). Use the form's `generate` button or supply at least 8 distinct characters.",
    };
  }

  const siteUrl = (raw.siteUrl ?? "").trim();
  if (!/^https?:\/\//.test(siteUrl)) {
    return { error: "SITE_URL must start with http:// or https://" };
  }
  // Naked `http://` passes the regex but `new URL` produces an
  // empty hostname — rejecting here means the SITE_URL we write
  // can be parsed by the safety check (#597) and the email-link
  // builders (#598).
  let siteHost: string | null = null;
  try {
    siteHost = new URL(siteUrl).hostname || null;
  } catch {
    return { error: "SITE_URL is not a valid URL — check the host portion" };
  }
  if (!siteHost) {
    return { error: "SITE_URL is missing the host portion (e.g. https://example.com)" };
  }

  const storage = raw.storage === "s3" ? "s3" : "local";
  if (storage === "s3") {
    if (!raw.s3Bucket?.trim()) return { error: "S3 bucket is required" };
    if (!raw.s3Region?.trim()) return { error: "S3 region is required" };
    const endpoint = raw.s3Endpoint?.trim();
    if (endpoint) {
      try {
        const u = new URL(endpoint);
        if (!u.hostname) {
          return { error: "S3 endpoint is missing the host portion" };
        }
      } catch {
        return { error: "S3 endpoint is not a valid URL" };
      }
    }
  }
  return {
    body: {
      databaseUrl,
      testDatabaseUrl: raw.testDatabaseUrl?.trim() || undefined,
      npSecret,
      siteUrl,
      storage,
      s3Bucket: raw.s3Bucket?.trim() || undefined,
      s3Region: raw.s3Region?.trim() || undefined,
      s3Endpoint: raw.s3Endpoint?.trim() || undefined,
      runMigrate: raw.runMigrate !== false,
    },
  };
}

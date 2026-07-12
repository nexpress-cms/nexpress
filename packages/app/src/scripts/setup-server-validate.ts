/**
 * Validation for the setup wizard's form submission. Extracted into
 * its own module so unit tests can exercise it without booting the
 * HTTP server (importing setup-server.ts triggers `createServer` at
 * module top level by design — it's an entrypoint script).
 */

import { npNormalizeSiteGeneralSettings } from "@nexpress/core/settings";

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
  adminEmail?: string;
  adminPassword?: string;
  adminName?: string;
  adminThemeId?: string;
  siteName?: string;
  defaultLocale?: string;
  timezone?: string;
  sampleContent?: boolean;
  requireFirstAdmin?: boolean;
}

export function validateBody(raw: Partial<SetupBody>): { body: SetupBody } | { error: string } {
  const databaseUrl = (raw.databaseUrl ?? "").trim();
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    return { error: "DATABASE_URL must start with postgres:// or postgresql://" };
  }
  // Parse beyond the protocol prefix — catches `postgres://` (no
  // host) and similar shapes that the regex accepts but the pg
  // connector would crash on at first use.
  try {
    const dbHost = new URL(databaseUrl).hostname || null;
    if (!dbHost) {
      return { error: "DATABASE_URL is missing the host portion" };
    }
  } catch {
    return { error: "DATABASE_URL is not a valid URL — check the host/port portion" };
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
  try {
    const siteHost = new URL(siteUrl).hostname || null;
    if (!siteHost) {
      return { error: "SITE_URL is missing the host portion (e.g. https://example.com)" };
    }
  } catch {
    return { error: "SITE_URL is not a valid URL — check the host portion" };
  }
  let canonicalSite: ReturnType<typeof npNormalizeSiteGeneralSettings>;
  try {
    canonicalSite = npNormalizeSiteGeneralSettings({
      name: raw.siteName?.trim() || "Default site",
      url: siteUrl,
      description: null,
      defaultLocale: raw.defaultLocale?.trim() || null,
      timezone: raw.timezone?.trim() || null,
    });
  } catch (error) {
    return {
      error: `Invalid site settings: ${error instanceof Error ? error.message : "unknown error"}`,
    };
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

  const adminEmail = raw.adminEmail?.trim() || undefined;
  const adminPassword =
    typeof raw.adminPassword === "string" && raw.adminPassword.length > 0
      ? raw.adminPassword
      : undefined;
  const wantsFirstAdmin =
    raw.requireFirstAdmin === true || Boolean(adminEmail) || Boolean(adminPassword);

  if (wantsFirstAdmin) {
    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return {
        error:
          "Admin email is required when completing first-boot setup now. Leave the first-admin fields blank to continue in /admin/setup.",
      };
    }
    if (!adminPassword || adminPassword.length < 12) {
      return {
        error:
          "Admin password must be at least 12 characters when completing first-boot setup now.",
      };
    }
  }

  return {
    body: {
      databaseUrl,
      testDatabaseUrl: raw.testDatabaseUrl?.trim() || undefined,
      npSecret,
      siteUrl: canonicalSite.url ?? siteUrl,
      storage,
      s3Bucket: raw.s3Bucket?.trim() || undefined,
      s3Region: raw.s3Region?.trim() || undefined,
      s3Endpoint: raw.s3Endpoint?.trim() || undefined,
      runMigrate: raw.runMigrate !== false,
      ...(adminEmail ? { adminEmail } : {}),
      ...(adminPassword ? { adminPassword } : {}),
      ...(raw.adminName?.trim() ? { adminName: raw.adminName.trim() } : {}),
      ...(raw.adminThemeId?.trim() ? { adminThemeId: raw.adminThemeId.trim() } : {}),
      ...(raw.siteName?.trim() ? { siteName: canonicalSite.name } : {}),
      ...(canonicalSite.defaultLocale ? { defaultLocale: canonicalSite.defaultLocale } : {}),
      ...(canonicalSite.timezone ? { timezone: canonicalSite.timezone } : {}),
      ...(wantsFirstAdmin && raw.sampleContent === true ? { sampleContent: true } : {}),
    },
  };
}

import {
  NP_DEFAULT_SITE_ID,
  NpConflictError,
  NpValidationError,
  ensureDefaultSite,
  hashPassword,
  npUsers,
  signToken,
  updateSite,
  withCurrentSite,
} from "@nexpress/core";
import { count, eq } from "drizzle-orm";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../lib/api-response";
import { getAuthRuntimeConfig, setAuthCookies } from "../../../lib/auth-helpers";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";
import { seedAll } from "../../../lib/seed-content";

/**
 * First-boot Admin Setup wizard endpoint.
 *
 *   - Allowed only when `np_users` has zero rows with `role = 'admin'`;
 *     once a real admin exists this route returns 409 (so a second
 *     visit can't hijack the install).
 *   - Creates the first admin, optionally renames the default site,
 *     optionally seeds demo content with the new admin as author.
 *   - Issues a fresh session immediately so the wizard can hand off
 *     the operator to `/admin` without a manual login round-trip.
 *
 * No CSRF gate — the request body carries the secret material
 * (password) and the gate is the "no admin yet" precondition. Once
 * an admin exists the same precondition rejects every retry.
 */

interface SetupBody {
  email: string;
  password: string;
  name?: string;
  siteName?: string;
  sampleContent?: boolean;
}

const PASSWORD_MIN = 12;

function validateBody(raw: unknown): SetupBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Request body must be an object" },
    ]);
  }
  const { email, password, name, siteName, sampleContent } = raw as Record<
    string,
    unknown
  >;
  const errors: Array<{ field: string; message: string }> = [];

  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: "email", message: "Valid email is required" });
  }
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    errors.push({
      field: "password",
      message: `Password must be at least ${PASSWORD_MIN} characters`,
    });
  }
  if (name !== undefined && typeof name !== "string") {
    errors.push({ field: "name", message: "Name must be a string" });
  }
  if (siteName !== undefined && typeof siteName !== "string") {
    errors.push({ field: "siteName", message: "Site name must be a string" });
  }
  if (sampleContent !== undefined && typeof sampleContent !== "boolean") {
    errors.push({
      field: "sampleContent",
      message: "sampleContent must be a boolean",
    });
  }
  if (errors.length > 0) {
    throw new NpValidationError("Invalid input", errors);
  }

  return {
    email: (email as string).trim(),
    password: password as string,
    ...(typeof name === "string" && name.trim().length > 0
      ? { name: name.trim() }
      : {}),
    ...(typeof siteName === "string" && siteName.trim().length > 0
      ? { siteName: siteName.trim() }
      : {}),
    ...(typeof sampleContent === "boolean" ? { sampleContent } : {}),
  };
}

async function adminCount(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(npUsers)
    .where(eq(npUsers.role, "admin"));
  return rows[0]?.value ?? 0;
}

export async function GET(): Promise<Response> {
  // Surface the gate to the wizard's server component so it can
  // redirect away when an admin already exists.
  try {
    await ensureFor("read");
    const existing = await adminCount();
    return npSuccessResponse({ available: existing === 0 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    await ensureFor("write");
    const body = validateBody(await readJsonBody(request));

    if ((await adminCount()) > 0) {
      // Belt: the page-level redirect already keeps a logged-out
      // visitor away. Braces: a stale tab that POSTs after another
      // operator finished setup must not silently insert a second
      // admin.
      throw new NpConflictError("Setup already completed");
    }

    // First-boot guarantee: `np_sites` is created by migrations but
    // the default row isn't seeded automatically (`ensureDefaultSite`
    // isn't wired into bootstrap). Without this, the wizard's
    // `updateSite(NP_DEFAULT_SITE_ID, …)` below throws `Site "default"
    // not found` and the operator gets a 400 with no recourse. Wiring
    // ensureDefaultSite into `ensureFor` is the longer-term fix; for
    // now call it explicitly here since the wizard is the path where
    // the absence first matters.
    await ensureDefaultSite();

    const db = getDb();
    const passwordHash = await hashPassword(body.password);

    // Race-tolerant insert. Two stale tabs landing here at once
    // would both pass the count check above; the email unique
    // constraint catches the loser. If a non-admin row already
    // owns the email we surface a clearer 409.
    const existingEmail = await db
      .select({ id: npUsers.id })
      .from(npUsers)
      .where(eq(npUsers.email, body.email))
      .limit(1);
    if (existingEmail[0]) {
      throw new NpConflictError("A user with that email already exists");
    }

    const [created] = await db
      .insert(npUsers)
      .values({
        email: body.email,
        password: passwordHash,
        name: body.name ?? "Admin",
        role: "admin",
      })
      .returning({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
      });

    if (!created) {
      throw new Error("Failed to create admin row");
    }

    // Admin row is committed (no transaction wraps the chain
    // below — adding one would force a drizzle `db.transaction()`
    // around updateSite + seedAll, both of which acquire their
    // own DB scope today). Without rollback, a later throw would
    // leave the admin row in place and every retry would hit the
    // `Setup already completed` gate. Wrap site-rename and
    // seeding as best-effort so the wizard still completes —
    // operator can fix data afterwards through the admin UI.
    const warnings: string[] = [];

    if (body.siteName) {
      try {
        await updateSite(NP_DEFAULT_SITE_ID, { name: body.siteName });
      } catch (siteErr) {
        const msg = siteErr instanceof Error ? siteErr.message : String(siteErr);
        console.error("[admin-setup] updateSite failed:", siteErr);
        warnings.push(
          `Site name update failed: ${msg}. You can rename the site from Admin → Settings.`,
        );
      }
    }

    let seeded: Awaited<ReturnType<typeof seedAll>> | null = null;
    if (body.sampleContent) {
      try {
        // Sample content needs the plugin host loaded so collection
        // hooks (slugField, search-vector, etc.) fire.
        await ensureFor("plugins");
        seeded = await withCurrentSite(NP_DEFAULT_SITE_ID, () =>
          seedAll({
            id: created.id,
            email: created.email,
            name: created.name,
            role: created.role,
            tokenVersion: created.tokenVersion,
          }),
        );
      } catch (seedErr) {
        const msg = seedErr instanceof Error ? seedErr.message : String(seedErr);
        // Print the full stack on the dev terminal so the operator
        // can diagnose silent seed failures (validation inside a
        // collection hook, a missing FK, etc.). The HTTP response
        // only carries the message; the stack is the diagnostic.
        console.error("[admin-setup] seedAll failed:", seedErr);
        warnings.push(
          `Sample content seeding failed: ${msg}. Admin account is ready; add content manually from Admin → Collections. Full stack is in the server log.`,
        );
      }
    }

    const config = getAuthRuntimeConfig();
    const access = await signToken(
      created,
      config.secret,
      config.tokenExpiration,
      "access",
    );
    const refresh = await signToken(
      created,
      config.secret,
      config.refreshTokenExpiration,
      "refresh",
    );
    const response = npSuccessResponse({
      user: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
      },
      seeded: seeded
        ? {
            pages: seeded.pages.created,
            posts: seeded.posts.created,
            tags: seeded.terms.tagsCreated,
            categories: seeded.terms.categoriesCreated,
            navItems: seeded.navigation.header + seeded.navigation.footer,
          }
        : null,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
    setAuthCookies(response, {
      access,
      refresh,
      csrf: crypto.randomUUID(),
    });
    return response;
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

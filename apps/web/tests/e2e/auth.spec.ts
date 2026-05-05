/**
 * Phase 23.6 — golden-path auth flow.
 *
 * The first thing every NexPress operator does. If this breaks
 * everything else is unreachable, so it's the cheapest test that
 * provides the largest amount of confidence and runs first.
 */

import { expect, test } from "@playwright/test";

import { signInViaForm } from "./fixtures/auth-helpers.js";
import { E2E_ADMIN } from "./fixtures/seed.js";

test.describe("admin sign-in / sign-out", () => {
  test("logs an admin in via the form, lands them on /admin, and signs them out", async ({
    page,
    context,
  }) => {
    // Bypass cached state from a previous run.
    await context.clearCookies();

    await signInViaForm(page);
    await expect(page).toHaveURL(/\/admin$/);

    // Verify the logout entry is reachable from the topbar UI —
    // shadcn's DropdownMenu closes on select and consumes the
    // click event before the wrapped form's submit can fire, so
    // we can't reliably trigger the actual POST through the menu
    // item. The presence of the menu item is what we're checking
    // here; the logout endpoint itself is exercised below.
    await page.getByRole("button", { name: new RegExp(E2E_ADMIN.name) }).click();
    await expect(page.getByRole("menuitem", { name: /logout/i })).toBeVisible();

    // POST /api/auth/logout directly to confirm the server-side
    // contract: the response is 200 + clears auth cookies.
    const logoutRes = await page.request.post("/api/auth/logout");
    expect(logoutRes.status()).toBe(200);

    // With np-session cleared, /admin must bounce back to /admin/login.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("rejects an invalid password without redirecting", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/admin/login");

    // Use a non-existent email so the lockout counter on the
    // real e2e admin doesn't tick up and break the happy-path
    // test on a re-run. The "user not found" branch returns the
    // same 401 shape as "wrong password" — both surface as the
    // same UI error.
    await page.locator("#email").fill("nobody-here@example.com");
    await page.locator("#password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // The form surfaces the error inline rather than redirecting.
    await expect(page.locator("text=/Invalid|failed/i")).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

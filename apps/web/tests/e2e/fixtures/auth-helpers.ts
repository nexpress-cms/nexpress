/**
 * Shared sign-in helper used by every authenticated spec
 * (Phase 23.6.1). Drives the actual login form rather than
 * planting a session cookie directly so the helper itself
 * stays end-to-end — if the login UI breaks, every dependent
 * spec fails at this helper rather than masquerading as a
 * downstream failure.
 *
 * Re-running the e2e fixture between specs already resets the
 * lockout counter, so a flaky spec that left the admin locked
 * out doesn't poison the next one.
 */

import { expect, type Page } from "@playwright/test";

import { E2E_ADMIN } from "./seed.js";

export async function signInAsE2EAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.locator("#email").fill(E2E_ADMIN.email);
  await page.locator("#password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/admin", { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${E2E_ADMIN.name}` }),
  ).toBeVisible();
}

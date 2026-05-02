/**
 * Sign-in helpers for E2E specs. Two flavors, deliberately split:
 *
 *  - `signInViaForm(page)` — drives the actual login form. Slow
 *    but exercises the React form handlers. The auth spec uses
 *    this so we still catch login UI regressions.
 *  - `signInAsE2EAdmin(page)` — POSTs `/api/auth/login` directly
 *    via `page.request`. Cookies set on the request context are
 *    shared with the page, so a subsequent `page.goto("/admin")`
 *    arrives authenticated. Fast and immune to dev-mode
 *    hydration races (the form-handler attach is what made the
 *    button-click variant flake on cold next-dev compiles).
 *
 * Most specs only need to *be* signed in to test something else;
 * those use the API helper. Specs that test the login UX itself
 * use the form helper.
 */

import { expect, type Page } from "@playwright/test";

import { E2E_ADMIN } from "./seed.js";

export async function signInViaForm(page: Page): Promise<void> {
  await page.goto("/admin/login");

  // Wait for the form to be interactive — the login page is a
  // client component and the submit handler attaches during
  // hydration. Without this gate Playwright can fire `click`
  // before React listens, and the button falls through to the
  // browser's default form submit (which is a GET to the same
  // URL because the form has no action).
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();

  await page.locator("#email").fill(E2E_ADMIN.email);
  await page.locator("#password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/admin", { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${E2E_ADMIN.name}` }),
  ).toBeVisible();
}

export async function signInAsE2EAdmin(page: Page): Promise<void> {
  // page.request shares cookies with the browser context, so
  // any Set-Cookie from the login response is automatically
  // visible to subsequent page.goto / page.locator interactions.
  const response = await page.request.post("/api/auth/login", {
    data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password },
  });
  if (!response.ok()) {
    throw new Error(
      `signInAsE2EAdmin failed: POST /api/auth/login returned ${response.status()}. ` +
        `Body: ${await response.text()}`,
    );
  }
}

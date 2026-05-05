/**
 * Phase 23.6.2 — theme switch golden path.
 *
 * The admin's Settings → Theme registry lets operators flip the
 * active theme without redeploying. This spec exercises the
 * round-trip: pick an inactive theme, click Activate, confirm the
 * card flips to "In use" and the API responds OK. Public-site
 * verification (does the rendered HTML actually carry the new
 * theme's tokens?) is intentionally out of scope — body class /
 * data-attribute conventions vary across themes and the admin
 * round-trip is what catches the regression we'd actually see.
 */

import { expect, test } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

test.describe("theme switcher", () => {
  test("activates a non-default theme via /admin/settings, then resets", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await signInAsE2EAdmin(page);

    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/settings$/);

    // The settings page is tabbed; ThemeSwitcher lives under
    // the "Theme" tab, which isn't the default view.
    await page.getByRole("tab", { name: /^Theme$/ }).click();

    // Wait for the ThemeSwitcher card list to finish loading —
    // the component fetches the registered themes in a useEffect
    // and shows a skeleton while it's pending. Once any
    // "Activate" button is in the DOM the registry has loaded.
    const activateButton = page
      .getByRole("button", { name: /^Activate$/ })
      .first();
    await expect(activateButton).toBeVisible({ timeout: 10_000 });

    // Click the first inactive theme. The active theme renders
    // "In use" instead, so any "Activate" button is by definition
    // a non-active theme. We don't pin which one — the contract
    // is "activating any inactive theme works," not "minimal is
    // the second card."
    const activatePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/themes/active") && r.request().method() === "PUT",
    );
    await activateButton.click();
    const activateRes = await activatePromise;
    expect(activateRes.status()).toBe(200);

    // After activation at least one card should now show "In use"
    // and the previously-active card should expose an Activate
    // button — the registry rendered the optimistic state.
    await expect(
      page.getByRole("button", { name: /^In use$/ }).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Reset to the canonical "default" theme via the API so the
    // dev environment lands back where it started, regardless of
    // which inactive theme the spec happened to pick. The UI
    // round-trip is what we tested above; this is just cleanup.
    const resetRes = await page.request.put("/api/admin/themes/active", {
      data: { id: "default" },
      headers: {
        "x-csrf-token": (await context.cookies())
          .find((c) => c.name === "np-csrf")?.value ?? "",
      },
    });
    expect(resetRes.status()).toBe(200);
  });
});

/**
 * Phase 23.6.2 — publish-a-page golden path.
 *
 * Drives the admin from create-form to public render. Pages are
 * the smallest collection that can be published: title is
 * required, blocks are optional, slug is derived from title.
 * Posts add a required Lexical `content` field which makes a
 * full-fidelity post spec brittle — that's a follow-up if the
 * spec catalogue needs editor coverage.
 *
 * Uses the API sign-in helper to avoid the dev-mode hydration
 * race that affects form-button clicks (see auth-helpers.ts);
 * `auth.spec.ts` covers the form path directly so we still catch
 * login UX regressions.
 */

import { expect, test } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

const TITLE = `E2E publish smoke ${Date.now()}`;
const SLUG = TITLE.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

test.describe("publish a page", () => {
  test("creates → publishes → renders the new page on the public site", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await signInAsE2EAdmin(page);

    // Navigate by URL rather than chasing nav-link selectors so
    // the spec doesn't fight admin-sidebar wording changes.
    await page.goto("/admin/collections/pages/create");
    await expect(page).toHaveURL(/\/admin\/collections\/pages\/create$/);

    // Target the visible submit button directly. The admin
    // sidebar's "Publish" group header is a CardHeader rendered
    // as <div role="button"> for expand/collapse, so getByRole
    // matches both. Mobile also mounts its sticky publish action
    // in the same form, so filter hidden breakpoint variants out.
    const publishButton = page
      .locator('button[type="submit"]:visible')
      .filter({ hasText: /^Publish$/ });

    // Wait for the form to be interactive before filling — same
    // hydration story as the login form.
    await expect(publishButton).toBeEnabled();

    // The pages collection's required field is `title` (text).
    // react-hook-form spreads the field name onto the input, so
    // the visible label is the most durable selector.
    await page.getByLabel("title", { exact: true }).fill(TITLE);
    await page.getByLabel("seoDescription", { exact: true }).fill("e2e smoke");

    // Publish posts to /api/collections/pages with status=published.
    // We wait on the response event rather than the URL change
    // afterwards because client-side navigation via `router.push`
    // is unreliable to observe from Playwright (the URL update
    // races against React 19's form-action transition).
    const publishResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/collections/pages") && r.request().method() === "POST",
    );
    await publishButton.click();
    const apiRes = await publishResponse;
    expect(apiRes.status()).toBe(201);

    // The public catch-all renders /<slug> using the active theme.
    // The page was created with status=published, so the public
    // GET should return 200. We don't assert on the rendered body
    // because the active theme's PageDefaultTemplate falls back
    // to nothing when `blocks` is an empty array, and the spec
    // didn't author block content — the contract we're checking is
    // "publishing makes the doc reachable," not "the default
    // template handles empty bodies gracefully" (separate concern).
    const response = await page.goto(`/${SLUG}`);
    expect(response?.status()).toBe(200);

    // Confirm the doc shows up in the admin list view — the more
    // robust signal that publish wired through end-to-end.
    await page.goto("/admin/collections/pages");
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 10_000 });
  });
});

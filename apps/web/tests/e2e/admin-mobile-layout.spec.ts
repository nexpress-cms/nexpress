/**
 * Admin mobile shell regression coverage.
 *
 * The admin sidebar should behave as an overlay drawer until the
 * desktop breakpoint. Tablet-width mobile viewports must keep the
 * content column full-width rather than letting the expanded nav
 * consume horizontal space.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

const MOBILE_VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
] as const;

const ADMIN_ROUTES = [
  { path: "/admin", label: "dashboard" },
  { path: "/admin/collections/pages", label: "pages list" },
  { path: "/admin/collections/pages/create", label: "page editor" },
  { path: "/admin/media", label: "media library" },
  { path: "/admin/sites", label: "sites" },
  { path: "/admin/users", label: "user management" },
  { path: "/admin/members", label: "members" },
  { path: "/admin/community/pending", label: "pending queue" },
  { path: "/admin/community/reports", label: "reports queue" },
  { path: "/admin/community/audit", label: "audit log" },
  { path: "/admin/community/settings", label: "community settings" },
  { path: "/admin/plugins", label: "plugins" },
  { path: "/admin/jobs", label: "jobs" },
  { path: "/admin/health", label: "health" },
  { path: "/admin/settings", label: "settings" },
] as const;

interface OverflowMetrics {
  viewportWidth: number;
  documentScrollWidth: number;
  bodyScrollWidth: number;
  offenders: Array<{
    selector: string;
    left: number;
    right: number;
    width: number;
    text: string;
  }>;
}

test.describe("admin mobile layout", () => {
  for (const [viewportIndex, viewport] of MOBILE_VIEWPORTS.entries()) {
    test(`keeps the sidebar as an overlay drawer at ${viewport.width}px`, async ({
      page,
      context,
    }) => {
      test.setTimeout(60_000);

      await context.clearCookies();
      // This spec hits many admin routes in one pass; isolate its
      // proxy rate-limit bucket so later E2E specs do not inherit it.
      await context.setExtraHTTPHeaders({
        "x-forwarded-for": `192.0.2.${10 + viewportIndex}`,
      });
      await signInAsE2EAdmin(page);
      await page.setViewportSize(viewport);

      for (const route of ADMIN_ROUTES) {
        await assertAdminRouteHasNoMobileOverflow(page, route);
      }
    });
  }

  test("keeps the page editor form controls tappable on narrow phones", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.90" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const response = await page.goto("/admin/collections/pages/create", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "admin page editor create route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin page editor form initial", {
      ignoreClosedSidebar: true,
    });

    const titleInput = page.getByLabel("title", { exact: true });
    const saveDraftButton = page.getByRole("button", { name: /^Save as Draft$/ });
    const scheduleButton = page.getByRole("button", { name: /^Schedule$/ });
    const publishButton = page.locator('button[type="submit"]').filter({ hasText: /^Publish$/ });

    await expect(titleInput).toBeVisible();
    await expect(saveDraftButton).toBeEnabled();
    await expect(scheduleButton).toBeEnabled();
    await expect(publishButton).toBeEnabled();

    await expectTouchTarget(titleInput, "title input");
    await expectTouchTarget(saveDraftButton, "save draft button");
    await expectTouchTarget(scheduleButton, "schedule button");
    await expectTouchTarget(publishButton, "publish button");

    const title = `Mobile editor draft ${Date.now()}`;
    await titleInput.fill(title);
    await page.getByLabel("seoDescription", { exact: true }).fill("mobile editor smoke");
    await expectNoHorizontalOverflow(page, "admin page editor form after fill", {
      ignoreClosedSidebar: true,
    });

    const draftResponse = page.waitForResponse(
      (res) => res.url().endsWith("/api/collections/pages") && res.request().method() === "POST",
    );
    await saveDraftButton.click();
    const createdResponse = await draftResponse;
    expect(createdResponse.status()).toBe(201);
    const created = (await createdResponse.json()) as { id?: unknown; title?: unknown };
    expect(typeof created.id).toBe("string");
    expect(created.title).toBe(title);
  });

  test("keeps operational list controls tappable on narrow phones", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.91" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const membersResponse = await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
    expect(membersResponse?.status(), "admin members list route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin members filters", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByLabel("Search", { exact: true }), "members search input");
    await expectTouchTarget(page.getByLabel("Status", { exact: true }), "members status select");
    await expectTouchTarget(page.getByRole("button", { name: /^Apply$/ }), "members apply button");

    const jobsResponse = await page.goto("/admin/jobs", { waitUntil: "domcontentloaded" });
    expect(jobsResponse?.status(), "admin jobs route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin jobs controls", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("tab", { name: /^Pending$/ }), "jobs pending tab");
    await expectTouchTarget(page.getByRole("tab", { name: /^Scheduled$/ }), "jobs scheduled tab");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Refresh$/ }).first(),
      "jobs refresh button",
    );

    await page.getByRole("tab", { name: /^Scheduled$/ }).click();
    const handlerSelect = page.locator("#np-job-enqueue-type");
    const payloadTextarea = page.locator("#np-job-enqueue-data");
    await expect(handlerSelect).toBeVisible();
    await expect(payloadTextarea).toBeVisible();
    await expectTouchTarget(handlerSelect, "jobs handler select");
    await expectTouchTarget(payloadTextarea, "jobs payload textarea");
    await expectTouchTarget(page.getByRole("button", { name: /^Enqueue$/ }), "jobs enqueue button");
  });
});

async function expectTouchTarget(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, label).not.toBeNull();
  expect(Math.round(box?.height ?? 0), label).toBeGreaterThanOrEqual(40);
}

async function assertAdminRouteHasNoMobileOverflow(
  page: Page,
  route: (typeof ADMIN_ROUTES)[number],
): Promise<void> {
  const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `admin ${route.label} ${route.path}`).toBe(200);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Build Error|Runtime Error|Unhandled/i);

  const openButton = page.getByRole("button", { name: "Open navigation" });
  await expect(openButton, `admin ${route.label} mobile nav trigger`).toBeVisible();
  await expectNoHorizontalOverflow(page, `admin ${route.label} closed`, {
    ignoreClosedSidebar: true,
  });

  const openSidebar = page.locator('[data-np-admin-sidebar][data-open="true"]');
  await expect(async () => {
    if (!(await openSidebar.isVisible().catch(() => false))) {
      await openButton.click();
    }
    await expect(openSidebar).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 8_000 });
  await waitForSidebarToSettle(page, "open");
  await expectNoHorizontalOverflow(page, `admin ${route.label} drawer open`);

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-np-admin-sidebar][data-open="false"]')).toBeVisible();
  await waitForSidebarToSettle(page, "closed");
  await expectNoHorizontalOverflow(page, `admin ${route.label} after close`, {
    ignoreClosedSidebar: true,
  });
}

async function waitForSidebarToSettle(page: Page, state: "open" | "closed"): Promise<void> {
  await page.waitForFunction(
    (targetState) => {
      const sidebar = document.querySelector("[data-np-admin-sidebar]");
      if (!sidebar) return false;
      const rect = sidebar.getBoundingClientRect();
      return targetState === "open" ? rect.left >= -1 : rect.right <= 1;
    },
    state,
    { timeout: 2_000 },
  );
}

async function expectNoHorizontalOverflow(
  page: Page,
  label: string,
  options: { ignoreClosedSidebar?: boolean } = {},
): Promise<void> {
  const metrics = await collectOverflowMetrics(page, options);
  expect(
    metrics.documentScrollWidth,
    `${label}\n${JSON.stringify(metrics, null, 2)}`,
  ).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.offenders, `${label}\n${JSON.stringify(metrics, null, 2)}`).toHaveLength(0);
}

async function collectOverflowMetrics(
  page: Page,
  options: { ignoreClosedSidebar?: boolean },
): Promise<OverflowMetrics> {
  return page.evaluate((evaluateOptions) => {
    const viewportWidth = window.innerWidth;
    const selectorFor = (element: Element): string => {
      const className =
        typeof element.className === "string"
          ? element.className.trim().split(/\s+/).filter(Boolean).join(".")
          : "";
      if (element.matches("[data-np-admin-sidebar]")) {
        return `aside[data-np-admin-sidebar][data-open="${element.getAttribute("data-open")}"]`;
      }
      if (className) return `${element.tagName.toLowerCase()}.${className}`;
      if (element.id) return `${element.tagName.toLowerCase()}#${element.id}`;
      return element.tagName.toLowerCase();
    };

    const offenders = Array.from(document.body.querySelectorAll("*"))
      .filter((element) => {
        if (!evaluateOptions.ignoreClosedSidebar) return true;
        return !element.closest('[data-np-admin-sidebar][data-open="false"]');
      })
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: selectorFor(element),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
        };
      })
      .filter((item) => item.width > 0 && (item.left < -1 || item.right > viewportWidth + 1))
      .slice(0, 12);

    return {
      viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders,
    };
  }, options);
}

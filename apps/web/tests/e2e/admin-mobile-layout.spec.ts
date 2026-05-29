/**
 * Admin mobile shell regression coverage.
 *
 * The admin sidebar should behave as an overlay drawer until the
 * desktop breakpoint. Tablet-width mobile viewports must keep the
 * content column full-width rather than letting the expanded nav
 * consume horizontal space.
 */

import { expect, test, type Page } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
] as const;

const ADMIN_ROUTES = [
  { path: "/admin", label: "dashboard" },
  { path: "/admin/collections/pages", label: "pages list" },
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
  test("keeps the sidebar as an overlay drawer on mobile and tablet widths", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await signInAsE2EAdmin(page);

    for (const viewport of MOBILE_VIEWPORTS) {
      await page.setViewportSize(viewport);

      for (const route of ADMIN_ROUTES) {
        await assertAdminRouteHasNoMobileOverflow(page, route);
      }
    }
  });
});

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

  await openButton.click();
  await expect(page.locator('[data-np-admin-sidebar][data-open="true"]')).toBeVisible();
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

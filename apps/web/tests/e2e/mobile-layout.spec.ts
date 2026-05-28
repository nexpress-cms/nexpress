/**
 * Mobile layout regression coverage for bundled public themes.
 *
 * The default theme's closed right-side drawer once lived just
 * outside the viewport and expanded `documentElement.scrollWidth`,
 * so a small horizontal swipe revealed half the menu. This spec
 * checks the rendered app, not just CSS strings: each bundled
 * theme is activated through the same reseed endpoint operators
 * use, then representative public routes are opened at mobile
 * widths and measured for horizontal overflow.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

type ThemeId = "default" | "docs" | "magazine" | "portfolio";

interface RouteCheck {
  path: string;
  label: string;
}

interface ThemeScenario {
  id: ThemeId;
  routes: RouteCheck[];
  mobileNavSelector?: string;
  viewports?: readonly ViewportSize[];
  expectNoMemberStatusLoading?: boolean;
}

interface ViewportSize {
  width: number;
  height: number;
}

const MOBILE_VIEWPORTS: readonly ViewportSize[] = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const THEMES: ThemeScenario[] = [
  {
    id: "default",
    mobileNavSelector: ".np-mobile-nav-toggle",
    viewports: [...MOBILE_VIEWPORTS, { width: 1024, height: 1365 }],
    expectNoMemberStatusLoading: true,
    routes: [
      { path: "/", label: "home post index" },
      {
        path: "/blog/read-your-writes-without-the-asterisks",
        label: "single post",
      },
      { path: "/tag/postgres", label: "tag archive" },
    ],
  },
  {
    id: "docs",
    routes: [
      { path: "/", label: "docs landing" },
      { path: "/docs/search", label: "docs search" },
      { path: "/docs/plugin-author-quickstart", label: "doc detail" },
    ],
  },
  {
    id: "magazine",
    mobileNavSelector: ".np-magazine-mobile-nav-toggle",
    routes: [
      { path: "/", label: "magazine front" },
      { path: "/features", label: "section archive" },
      { path: "/category/features", label: "category archive" },
    ],
  },
  {
    id: "portfolio",
    mobileNavSelector: ".np-portfolio-nav-toggle",
    routes: [
      { path: "/", label: "portfolio work index" },
      { path: "/studio", label: "studio page" },
      { path: "/work/hanmi-gallery-complete-identity", label: "project detail" },
    ],
  },
];

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

test.describe.configure({ mode: "serial" });

test.describe("bundled theme mobile layout", () => {
  for (const theme of THEMES) {
    test(`${theme.id} has no mobile horizontal overflow on representative routes`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await signInAsE2EAdmin(page);
      await reseedTheme(page, context, theme.id);

      for (const viewport of theme.viewports ?? MOBILE_VIEWPORTS) {
        await page.setViewportSize(viewport);

        for (const route of theme.routes) {
          await assertRouteHasNoMobileOverflow(page, theme, route);
        }
      }
    });
  }
});

async function reseedTheme(page: Page, context: BrowserContext, themeId: ThemeId): Promise<void> {
  const csrf = await csrfToken(context);
  const response = await page.request.post("/api/admin/themes/reseed", {
    data: { themeId },
    headers: { "x-csrf-token": csrf },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function csrfToken(context: BrowserContext): Promise<string> {
  const csrf = (await context.cookies()).find((cookie) => cookie.name === "np-csrf")?.value;
  if (!csrf) {
    throw new Error("Missing np-csrf cookie after e2e admin sign-in.");
  }
  return csrf;
}

async function assertRouteHasNoMobileOverflow(
  page: Page,
  theme: ThemeScenario,
  route: RouteCheck,
): Promise<void> {
  const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${theme.id} ${route.label} ${route.path}`).toBe(200);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Build Error|Runtime Error|Unhandled/i);
  if (theme.expectNoMemberStatusLoading) {
    await expectMemberStatusNotToRenderLoadingChrome(page);
  }

  await expectNoHorizontalOverflow(page, `${theme.id} ${route.label} closed`);

  if (!theme.mobileNavSelector) return;
  const toggle = page.locator(theme.mobileNavSelector).first();
  await expect(toggle, `${theme.id} mobile nav toggle`).toBeVisible();
  await toggle.click();
  await page.waitForTimeout(250);
  await expectNoHorizontalOverflow(page, `${theme.id} ${route.label} drawer open`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await expectNoHorizontalOverflow(page, `${theme.id} ${route.label} after close`);
}

async function expectMemberStatusNotToRenderLoadingChrome(page: Page): Promise<void> {
  const loadingCount = await page.locator(".np-member-status-loading").count();
  expect(loadingCount).toBe(0);
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const metrics = await collectOverflowMetrics(page);
  expect(
    metrics.documentScrollWidth,
    `${label}\n${JSON.stringify(metrics, null, 2)}`,
  ).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.offenders, `${label}\n${JSON.stringify(metrics, null, 2)}`).toHaveLength(0);
}

async function collectOverflowMetrics(page: Page): Promise<OverflowMetrics> {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const selectorFor = (element: Element): string => {
      const className =
        typeof element.className === "string"
          ? element.className.trim().split(/\s+/).filter(Boolean).join(".")
          : "";
      if (className) return `${element.tagName.toLowerCase()}.${className}`;
      if (element.id) return `${element.tagName.toLowerCase()}#${element.id}`;
      return element.tagName.toLowerCase();
    };

    const offenders = Array.from(document.body.querySelectorAll("*"))
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
  });
}

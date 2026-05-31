/**
 * Admin mobile shell regression coverage.
 *
 * The admin sidebar should behave as an overlay drawer until the
 * desktop breakpoint. Tablet-width mobile viewports must keep the
 * content column full-width rather than letting the expanded nav
 * consume horizontal space.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { E2E_ADMIN } from "./fixtures/seed.js";

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

  test("keeps dashboard shortcuts tappable on narrow phones", async ({ page, context }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.89" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const response = await page.goto("/admin", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "admin dashboard route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin dashboard initial", {
      ignoreClosedSidebar: true,
    });

    const shortcuts = page.locator("[data-np-dashboard-shortcuts]");
    await expect(shortcuts).toBeVisible();
    await expectTouchTarget(shortcuts.getByRole("link", { name: /^View site$/ }), "view site");
    await expectTouchTarget(
      shortcuts.getByRole("button", { name: /^Upload Media$/ }),
      "dashboard upload media",
    );
    await expectTouchTarget(
      shortcuts.getByRole("button", { name: /^New entry$/ }),
      "dashboard new entry",
    );

    await shortcuts.getByRole("button", { name: /^Upload Media$/ }).click();
    await expect(page).toHaveURL(/\/admin\/media$/);
    await expectNoHorizontalOverflow(page, "admin dashboard shortcut navigation", {
      ignoreClosedSidebar: true,
    });
  });

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
    const mobileActions = page.locator("[data-np-mobile-editor-actions]");
    const saveDraftButton = mobileActions.getByRole("button", { name: /^Save as Draft$/ });
    const scheduleButton = mobileActions.getByRole("button", { name: /^Schedule$/ });
    const publishButton = mobileActions.getByRole("button", { name: /^Publish$/ });

    await expect(titleInput).toBeVisible();
    await expect(mobileActions).toBeVisible();
    await expect(saveDraftButton).toBeEnabled();
    await expect(scheduleButton).toBeEnabled();
    await expect(publishButton).toBeEnabled();

    await expectTouchTarget(titleInput, "title input");
    await expectTouchTarget(mobileActions, "mobile editor action bar");
    await expectTouchTarget(saveDraftButton, "save draft button");
    await expectTouchTarget(scheduleButton, "schedule button");
    await expectTouchTarget(publishButton, "publish button");

    await scheduleButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectTouchTarget(page.getByRole("button", { name: /^Cancel$/ }), "schedule cancel");
    await page.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(mobileActions).toBeInViewport();
    await expectNoHorizontalOverflow(page, "admin page editor form after deep scroll", {
      ignoreClosedSidebar: true,
    });

    const title = `Mobile editor draft ${Date.now()}`;
    await titleInput.scrollIntoViewIfNeeded();
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

    const editResponse = await page.goto(`/admin/collections/pages/${String(created.id)}`, {
      waitUntil: "domcontentloaded",
    });
    expect(editResponse?.status(), "admin page editor edit route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin page editor edit initial", {
      ignoreClosedSidebar: true,
    });

    const navPanel = page.locator("[data-np-nav-membership-panel]");
    await navPanel.scrollIntoViewIfNeeded();
    await expect(navPanel).toBeVisible();
    await expectTouchTarget(navPanel.getByRole("button", { name: /^Add$/ }), "nav add button");
    await expectNoHorizontalOverflow(page, "admin page editor navigation panel", {
      ignoreClosedSidebar: true,
    });

    const revisionsPanel = page.locator("[data-np-revisions-panel]");
    await revisionsPanel.scrollIntoViewIfNeeded();
    await expect(revisionsPanel).toBeVisible();
    await expect(async () => {
      expect(
        await revisionsPanel.getByRole("button", { name: /^Restore$/ }).count(),
      ).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
    await expectTouchTarget(
      revisionsPanel.getByRole("button", { name: /^Restore$/ }).first(),
      "revision restore button",
    );
    await expectNoHorizontalOverflow(page, "admin page editor revisions panel", {
      ignoreClosedSidebar: true,
    });
  });

  test("keeps page-builder edit controls tappable on narrow phones", async ({ page, context }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.92" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const response = await page.goto("/admin/collections/pages/create", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "admin page editor create route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin page-builder initial controls", {
      ignoreClosedSidebar: true,
    });

    await expectTouchTarget(
      page.locator('[role="tablist"][aria-label="Editor view"]'),
      "editor view toggle",
    );
    await expectTouchTarget(
      page.getByRole("button", { name: /Open pattern library/ }),
      "pattern library button",
    );
    await expectTouchTarget(page.getByRole("button", { name: /^Undo$/ }), "undo button");
    await expectTouchTarget(page.getByRole("button", { name: /^Redo$/ }), "redo button");

    await page.getByRole("button", { name: /^Hero$/ }).click();
    const firstRow = page.locator("[data-np-block-row]").first();
    await expect(firstRow).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin page-builder after adding block", {
      ignoreClosedSidebar: true,
    });

    await expectTouchTarget(
      firstRow.locator("[data-np-block-select-target]").first(),
      "block select checkbox",
    );
    await expectTouchTarget(firstRow.getByRole("button", { name: /^Drag / }), "block drag handle");
    await expectTouchTarget(
      firstRow.getByRole("button", { name: /^Collapse block$/ }),
      "block collapse button",
    );
    await expectTouchTarget(firstRow.getByRole("button", { name: /^Move up$/ }), "move up button");
    await expectTouchTarget(
      firstRow.getByRole("button", { name: /^Duplicate$/ }),
      "duplicate button",
    );
    await expectTouchTarget(
      firstRow.getByRole("button", { name: /^Edit as JSON$/ }),
      "edit-json button",
    );

    await firstRow.getByRole("button", { name: /^Collapse block$/ }).click();
    await expect(firstRow.getByRole("button", { name: /^Expand block$/ })).toBeVisible();
    await expectTouchTarget(
      firstRow.getByRole("button", { name: /^Expand block$/ }),
      "block expand button",
    );
  });

  test("keeps collection list cards and bulk controls tappable on narrow phones", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.93" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const title = `Mobile list draft ${Date.now()}`;
    await createDraftPage(page, title);

    const response = await page.goto(
      `/admin/collections/pages?search=${encodeURIComponent(title)}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    expect(response?.status(), "admin pages list route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin collection list searched", {
      ignoreClosedSidebar: true,
    });

    await expectTouchTarget(page.getByPlaceholder("Search pages..."), "pages search input");
    await expectTouchTarget(page.getByRole("link", { name: /^Create$/ }), "pages create link");

    const row = page.locator("[data-np-collection-mobile-row]").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expectTouchTarget(
      row.locator("[data-np-collection-row-select-target]"),
      "collection row select checkbox",
    );
    await expectTouchTarget(row.getByRole("link", { name: `Open ${title}` }), "row open link");

    await row.locator("[data-np-collection-row-select-target]").click();
    await expect(page.getByText("1 selected")).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin collection list selected", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("button", { name: /^Publish$/ }), "bulk publish");
    await expectTouchTarget(page.getByRole("button", { name: /^Unpublish$/ }), "bulk unpublish");
    await expectTouchTarget(page.getByRole("button", { name: /^Delete$/ }), "bulk delete");
    await expectTouchTarget(page.getByRole("button", { name: /^Clear$/ }), "bulk clear");

    await page.getByRole("button", { name: /^Delete$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectTouchTarget(page.getByRole("button", { name: /^Cancel$/ }), "delete cancel");
    await expectTouchTarget(page.getByRole("button", { name: /^Delete 1$/ }), "delete confirm");
    await page.getByRole("button", { name: /^Cancel$/ }).click();

    await expectTouchTarget(page.getByRole("button", { name: /^Previous$/ }), "previous page");
    await expectTouchTarget(page.getByRole("button", { name: /^Next$/ }), "next page");
  });

  test("keeps media library controls tappable on narrow phones", async ({ page, context }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.94" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const response = await page.goto("/admin/media", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "admin media library route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin media library initial", {
      ignoreClosedSidebar: true,
    });

    await expectTouchTarget(page.getByRole("button", { name: /^All media$/ }), "all media folder");
    await expectTouchTarget(page.getByPlaceholder("Search media"), "media search input");
    await expectTouchTarget(page.getByRole("button", { name: /^All$/ }), "uploader all filter");
    await expectTouchTarget(page.getByRole("button", { name: /^Staff$/ }), "uploader staff filter");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Members$/ }),
      "uploader members filter",
    );
    await expectTouchTarget(page.getByRole("button", { name: /^Grid view$/ }), "grid view toggle");
    await expectTouchTarget(page.getByRole("button", { name: /^List view$/ }), "list view toggle");
    await expectTouchTarget(page.getByRole("button", { name: /^Upload$/ }), "media upload button");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Delete selected$/ }),
      "media delete selected button",
    );

    const filename = `mobile-media-${Date.now()}.png`;
    await page.getByRole("button", { name: /^Upload$/ }).click();
    const uploadDialog = page.locator("[data-np-media-upload-dialog]");
    await expect(uploadDialog).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin media upload dialog", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("button", { name: /^Choose files$/ }), "choose files");
    await expectTouchTarget(page.getByRole("button", { name: /^Close$/ }), "upload close");

    const uploadResponse = page.waitForResponse(
      (res) => res.url().endsWith("/api/media/upload") && res.request().method() === "POST",
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    expect((await uploadResponse).status()).toBeGreaterThanOrEqual(200);
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    await page.getByPlaceholder("Search media").fill(filename);
    const gridCard = page.locator("[data-np-media-grid-card]").filter({ hasText: filename });
    await expect(gridCard).toBeVisible({ timeout: 10_000 });
    await expectNoHorizontalOverflow(page, "admin media grid after upload", {
      ignoreClosedSidebar: true,
    });
    const gridSelectTarget = gridCard.locator("[data-np-media-select-target]");
    await expectTouchTarget(gridSelectTarget, "media grid select target");
    const gridCheckbox = gridSelectTarget.getByRole("checkbox", { name: `Select ${filename}` });
    await gridCheckbox.check();
    await expect(gridCheckbox).toBeChecked();
    await expect(page.getByText("1 item selected")).toBeVisible();
    await expectTouchTarget(
      page.getByRole("button", { name: /^Delete selected$/ }),
      "media selected delete button",
    );

    await page.getByRole("button", { name: /^List view$/ }).click();
    const listCard = page.locator("[data-np-media-list-card]").filter({ hasText: filename });
    await expect(listCard).toBeVisible();
    const listSelectTarget = listCard.locator("[data-np-media-select-target]");
    await expectTouchTarget(listSelectTarget, "media list select target");
    const listCheckbox = listSelectTarget.getByRole("checkbox", { name: `Select ${filename}` });
    await listCheckbox.check();
    await expect(listCheckbox).toBeChecked();
    await expect(page.getByText("1 item selected")).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin media list selected", {
      ignoreClosedSidebar: true,
    });

    await page.getByRole("button", { name: /^Delete selected$/ }).click();
    const deleteDialog = page.locator("[data-np-media-delete-dialog]");
    await expect(deleteDialog).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin media delete dialog", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("button", { name: /^Cancel$/ }), "media delete cancel");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Delete 1$/ }),
      "media delete confirm",
    );

    const deleteResponse = page.waitForResponse(
      (res) =>
        /\/api\/media\/[^/]+$/.test(new URL(res.url()).pathname) &&
        res.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: /^Delete 1$/ }).click();
    expect((await deleteResponse).status()).toBe(200);
    await expect(page.getByText(filename)).toBeHidden({ timeout: 10_000 });
  });

  test("keeps settings and plugin controls tappable on narrow phones", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.95" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const settingsResponse = await page.goto("/admin/settings", {
      waitUntil: "domcontentloaded",
    });
    expect(settingsResponse?.status(), "admin settings route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin settings initial", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("tab", { name: /^General$/ }), "settings general tab");
    await expectTouchTarget(page.getByRole("tab", { name: /^SEO$/ }), "settings seo tab");
    await expectTouchTarget(page.getByRole("tab", { name: /^Navigation$/ }), "settings nav tab");
    await expectTouchTarget(page.getByLabel("Site name"), "settings site name input");
    await expectTouchTarget(page.getByLabel("Site URL"), "settings site url input");
    await expectTouchTarget(page.getByLabel("Description"), "settings description textarea");
    await expectTouchTarget(page.getByRole("button", { name: /^Save$/ }), "settings save button");

    const pluginsResponse = await page.goto("/admin/plugins", {
      waitUntil: "domcontentloaded",
    });
    expect(pluginsResponse?.status(), "admin plugins route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin plugins initial", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("button", { name: /^Reload all$/ }), "plugins reload");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Browse registry$/ }),
      "plugins browse registry",
    );
    await expectTouchTarget(
      page.getByRole("button", { name: /^Install plugin$/ }),
      "plugins install guide",
    );

    const detailsButton = page.getByRole("button", { name: /^Show details$/ }).first();
    await expectTouchTarget(detailsButton, "plugin show details");
    await detailsButton.click();
    await expect(page.getByRole("button", { name: /^Hide details$/ }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin plugins details open", {
      ignoreClosedSidebar: true,
    });

    await expectTouchTarget(page.getByRole("switch").first(), "plugin toggle switch");

    const configureButton = page.getByRole("button", { name: /^Configure$/ }).first();
    await expectTouchTarget(configureButton, "plugin configure button");
    await configureButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectTouchTarget(page.getByRole("button", { name: /^Cancel$/ }), "plugin config cancel");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Save config$/ }),
      "plugin config save",
    );
  });

  test("keeps deep settings tabs tappable on narrow phones", async ({ page, context }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.96" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const response = await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "admin settings route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin deep settings initial", {
      ignoreClosedSidebar: true,
    });

    await page.getByRole("tab", { name: /^Theme$/ }).click();
    await expect(page.getByRole("heading", { name: /^Colors$/ })).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin settings theme tab", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByLabel("Primary", { exact: true }), "theme primary input");
    await expectTouchTarget(page.getByRole("button", { name: /^Import JSON$/ }), "theme import");
    await expectTouchTarget(page.getByRole("button", { name: /^Export JSON$/ }), "theme export");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Reset to Defaults$/ }),
      "theme reset defaults",
    );
    await expectTouchTarget(page.getByRole("button", { name: /^Save Theme$/ }), "theme save");

    await page.getByRole("tab", { name: /^Navigation$/ }).click();
    await expect(page.getByRole("heading", { name: /^Navigation structure$/ })).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin settings navigation tab", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("button", { name: /^Add item$/ }), "nav add item");
    await expectTouchTarget(page.getByRole("button", { name: /^Save$/ }), "nav save");
    await page.getByRole("button", { name: /^Add item$/ }).click();
    await expect(page.getByLabel("Label").last()).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin settings navigation item", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByLabel("Label").last(), "nav item label input");
    await expectTouchTarget(page.getByLabel("URL").last(), "nav item url input");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Drag to reorder$/ }).last(),
      "nav drag handle",
    );
    await expectTouchTarget(
      page.getByRole("button", { name: /^Remove navigation item$/ }).last(),
      "nav remove item",
    );

    await page.getByRole("tab", { name: /^Users$/ }).click();
    await expect(page.getByRole("heading", { name: /^User management$/ })).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin settings users tab", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("button", { name: /^Invite user$/ }), "invite user");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Create with password$/ }),
      "create user with password",
    );

    await page.getByRole("button", { name: /^Invite user$/ }).click();
    const inviteDialog = page.locator("[data-np-user-invite-dialog]");
    await expect(inviteDialog).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin settings invite user dialog", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(inviteDialog.getByLabel("Name"), "invite user name");
    await expectTouchTarget(inviteDialog.getByLabel("Email"), "invite user email");
    await expectTouchTarget(
      inviteDialog.getByRole("button", { name: /^Cancel$/ }),
      "invite cancel",
    );
    await expectTouchTarget(
      inviteDialog.getByRole("button", { name: /^Send invite$/ }),
      "invite send",
    );
    await inviteDialog.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(inviteDialog).toBeHidden();

    await page.getByRole("button", { name: /^Create with password$/ }).click();
    const createDialog = page.locator("[data-np-user-create-dialog]");
    await expect(createDialog).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin settings create user dialog", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(createDialog.getByLabel("Name"), "create user name");
    await expectTouchTarget(createDialog.getByLabel("Email"), "create user email");
    await expectTouchTarget(createDialog.getByLabel("Password"), "create user password");
    await expectTouchTarget(
      createDialog.getByRole("button", { name: /^Cancel$/ }),
      "create user cancel",
    );
    await expectTouchTarget(
      createDialog.getByRole("button", { name: /^Create user$/ }),
      "create user submit",
    );
    await createDialog.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(createDialog).toBeHidden();
  });

  test("keeps site and membership dialogs tappable on narrow phones", async ({ page, context }) => {
    test.setTimeout(60_000);

    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.97" });
    await signInAsE2EAdmin(page);
    await page.setViewportSize({ width: 360, height: 780 });

    const sitesResponse = await page.goto("/admin/sites", { waitUntil: "domcontentloaded" });
    expect(sitesResponse?.status(), "admin sites route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin sites initial", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("button", { name: /^Add site$/ }), "add site button");
    await expectTouchTarget(
      page
        .locator("main")
        .getByRole("link", { name: /^Members$/ })
        .first(),
      "members link",
    );

    await page.getByRole("button", { name: /^Add site$/ }).click();
    const siteDialog = page.locator("[data-np-site-create-dialog]");
    await expect(siteDialog).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin site create dialog", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(siteDialog.getByLabel("Site id"), "site id input");
    await expectTouchTarget(siteDialog.getByLabel("Display name"), "site name input");
    await expectTouchTarget(siteDialog.getByLabel("Hostname (optional)"), "site hostname input");
    await expectTouchTarget(
      siteDialog.getByLabel("Description (optional)"),
      "site description input",
    );
    await expectTouchTarget(siteDialog.getByRole("button", { name: /^Cancel$/ }), "site cancel");
    await expectTouchTarget(
      siteDialog.getByRole("button", { name: /^Create site$/ }),
      "site create",
    );
    await siteDialog.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(siteDialog).toBeHidden();

    const membersResponse = await page.goto("/admin/sites/default/members", {
      waitUntil: "domcontentloaded",
    });
    expect(membersResponse?.status(), "default site members route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin site members initial", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(page.getByRole("link", { name: /^All sites$/ }), "all sites link");
    await expectTouchTarget(
      page.getByRole("button", { name: /^Grant membership$/ }),
      "grant membership",
    );

    await page.getByRole("button", { name: /^Grant membership$/ }).click();
    const grantDialog = page.locator("[data-np-membership-grant-dialog]");
    await expect(grantDialog).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin membership grant dialog", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(grantDialog.getByLabel("User"), "grant user search");
    await expectTouchTarget(grantDialog.getByLabel("Role"), "grant role select");
    await expectTouchTarget(grantDialog.getByRole("button", { name: /^Cancel$/ }), "grant cancel");
    await expectTouchTarget(grantDialog.getByRole("button", { name: /^Grant$/ }), "grant submit");

    await grantDialog.getByLabel("User").fill(E2E_ADMIN.email);
    const result = grantDialog.getByRole("button", { name: new RegExp(E2E_ADMIN.email) });
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expectTouchTarget(result, "grant user result");
    await result.click();
    await expect(grantDialog.getByText(E2E_ADMIN.email)).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin membership grant selected user", {
      ignoreClosedSidebar: true,
    });
    await expectTouchTarget(grantDialog.getByRole("button", { name: /^Change$/ }), "grant change");
    await grantDialog.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(grantDialog).toBeHidden();
  });

  test("keeps operational list controls tappable on narrow phones", async ({ page, context }) => {
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
    await page.getByLabel("Search", { exact: true }).fill("mobile");
    await page.getByRole("button", { name: /^Apply$/ }).click();
    await expect(page).toHaveURL(/\/admin\/members\?q=mobile/);
    await expectTouchTarget(page.getByRole("link", { name: /^Clear$/ }), "members clear link");

    const auditResponse = await page.goto("/admin/community/audit", {
      waitUntil: "domcontentloaded",
    });
    expect(auditResponse?.status(), "admin audit log route").toBe(200);
    await expectNoHorizontalOverflow(page, "admin audit filters collapsed", {
      ignoreClosedSidebar: true,
    });
    const auditFilterToggle = page.getByRole("button", { name: /^Show filters$/ });
    await expectTouchTarget(auditFilterToggle, "audit filter toggle");
    await auditFilterToggle.click();
    await expect(page.getByRole("button", { name: /^Hide filters$/ })).toBeVisible();
    const auditMobileFilters = page.locator("#np-audit-mobile-filters");
    await expectTouchTarget(
      auditMobileFilters.getByLabel("Target type"),
      "audit target type input",
    );
    await expectTouchTarget(auditMobileFilters.getByLabel("Target id"), "audit target id input");
    await expectTouchTarget(
      auditMobileFilters.getByLabel("Actor user id (staff)"),
      "audit actor user input",
    );
    await expectTouchTarget(
      auditMobileFilters.getByLabel("Actor member id"),
      "audit actor member input",
    );
    await expectTouchTarget(auditMobileFilters.getByLabel("Action"), "audit action input");
    await expectTouchTarget(auditMobileFilters.getByLabel("Since"), "audit since input");
    await expectTouchTarget(auditMobileFilters.getByLabel("Until"), "audit until input");
    await auditMobileFilters.getByLabel("Action").fill("member.ban.issue");
    await expectTouchTarget(
      auditMobileFilters.getByRole("button", { name: /^Apply$/ }),
      "audit apply button",
    );
    await expectTouchTarget(
      auditMobileFilters.getByRole("button", { name: /^Clear$/ }),
      "audit clear button",
    );
    await auditMobileFilters.getByRole("button", { name: /^Apply$/ }).click();
    await expect(page.getByRole("button", { name: /^Show filters$/ })).toBeVisible();
    await expect(page.getByText("1 active")).toBeVisible();
    await expectNoHorizontalOverflow(page, "admin audit filters applied", {
      ignoreClosedSidebar: true,
    });

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

async function createDraftPage(page: Page, title: string): Promise<void> {
  const response = await page.goto("/admin/collections/pages/create", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status(), "admin page editor create route").toBe(200);

  const saveDraftButton = page.getByRole("button", { name: /^Save as Draft$/ });
  const titleInput = page.getByLabel("title", { exact: true });
  const seoDescriptionInput = page.getByLabel("seoDescription", { exact: true });
  await expect(saveDraftButton).toBeEnabled();
  await expect(titleInput).toBeVisible();
  await expect(seoDescriptionInput).toBeVisible();
  await titleInput.fill(title);
  await seoDescriptionInput.fill("mobile list smoke");
  await expect(titleInput).toHaveValue(title);
  await expect(seoDescriptionInput).toHaveValue("mobile list smoke");

  const draftResponse = page.waitForResponse(
    (res) => res.url().endsWith("/api/collections/pages") && res.request().method() === "POST",
  );
  await saveDraftButton.click();
  const responseBody = await draftResponse;
  expect(
    responseBody.status(),
    responseBody.status() === 201 ? undefined : await responseBody.text(),
  ).toBe(201);
}

async function expectTouchTarget(locator: Locator, label: string): Promise<void> {
  await expect(locator, label).toBeVisible();
  await expect(async () => {
    const height = await locator.evaluate((element) =>
      Math.round(element.getBoundingClientRect().height),
    );
    expect(height, label).toBeGreaterThanOrEqual(40);
  }).toPass({ timeout: 5_000 });
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

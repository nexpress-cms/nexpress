import { randomUUID } from "node:crypto";

import { hashPassword } from "@nexpress/core/auth";
import { createDbConnection, npCloseDbConnection, npMembers } from "@nexpress/core/db";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";

for (const [index, kind] of ["restock", "price"].entries()) {
  test(`${kind} alerts recover from errors, persist subscriptions and cancel the selected variant`, async ({
    page,
    context,
  }, testInfo) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for the Shop browser fixture.");
    await isolateE2ERateLimitBucket(
      context,
      40 +
        index +
        testInfo.retry * 2 +
        testInfo.repeatEachIndex * (testInfo.project.retries + 1) * 2,
    );
    await signInAsE2EAdmin(page);
    const staffCsrf = (await context.cookies()).find((cookie) => cookie.name === "np-csrf")?.value;
    if (!staffCsrf) throw new Error("Missing staff CSRF cookie.");
    const staffHeaders = { "X-CSRF-Token": staffCsrf };
    const detailResponse = await page.request.get("/api/plugins/shop");
    expect(detailResponse.status()).toBe(200);
    const detail: { enabled: boolean } = await detailResponse.json();

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const memberId = randomUUID();
    const email = `alert-${suffix}@example.com`;
    const password = "E2E-alert-password-1234";
    const slug = `alert-${suffix}`;
    const selectedSku = `ALERT-B-${suffix.toUpperCase()}`;
    const apiPath = `/api/plugins/shop/${kind}-alerts`;
    // Match the existing E2E admin seed's standalone fixture connection; the app
    // keeps its own bootstrap owner. Close this connection in every outcome.
    const db = createDbConnection({ connectionString: databaseUrl, poolOptions: { max: 1 } });
    let productId: string | undefined;
    let releaseResponse: () => void = () => {};
    try {
      if (!detail.enabled) {
        const enabled = await page.request.patch("/api/plugins/shop", {
          headers: staffHeaders,
          data: { enabled: true },
        });
        expect(enabled.status()).toBe(200);
      }
      const productResponse = await page.request.post("/api/collections/shop-products", {
        headers: staffHeaders,
        data: {
          name: `Alert browser fixture ${suffix}`,
          slug,
          description: npCreateEmptyRichTextContent(),
          currency: "KRW",
          priceMinor: 1000,
          trackInventory: true,
          stockQuantity: 0,
          variants: [
            {
              name: "First option",
              sku: `ALERT-A-${suffix.toUpperCase()}`,
              stockQuantity: 0,
              enabled: true,
            },
            { name: "Second option", sku: selectedSku, stockQuantity: 0, enabled: true },
          ],
          _status: "published",
        },
      });
      expect(productResponse.status()).toBe(201);
      const product: { id: string } = await productResponse.json();
      productId = product.id;
      await db.insert(npMembers).values({
        id: memberId,
        handle: `alert-${suffix}`,
        email,
        displayName: "Alert browser fixture",
        password: await hashPassword(password),
        emailVerified: true,
        status: "active",
      });
      const login = await page.request.post("/api/members/login", { data: { email, password } });
      expect(login.status()).toBe(200);
      const memberCsrf = (await context.cookies()).find(
        (cookie) => cookie.name === "np-mb-csrf",
      )?.value;
      if (!memberCsrf) throw new Error("Missing member CSRF cookie.");

      const heldResponse = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      let rejectFirstPost = true;
      await page.route(`**${apiPath}`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        if (rejectFirstPost) {
          rejectFirstPost = false;
          return route.fulfill({ status: 503, json: { message: "Alert temporarily unavailable" } });
        }
        const response = await route.fetch();
        await heldResponse;
        await route.fulfill({ response });
      });
      await page.goto(`/shop/products/${slug}`);
      const alert = page.locator(`[data-np-shop-${kind}-alert]`);
      const button = alert.getByRole("button");
      await alert.getByRole("combobox").selectOption(selectedSku);
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await button.click();
      await expect(alert.getByRole("alert")).toHaveText("Alert temporarily unavailable");
      await expect(button).toBeEnabled();
      await expect(button).toHaveAttribute("aria-pressed", "false");

      const subscribeRequest = page.waitForRequest(
        (request) => new URL(request.url()).pathname === apiPath && request.method() === "POST",
      );
      await button.click();
      const subscribed = await subscribeRequest;
      expect(subscribed.postDataJSON()).toEqual({ productId, variantSku: selectedSku });
      expect((await subscribed.allHeaders())["x-csrf-token"]).toBe(memberCsrf);
      await expect(button).toBeDisabled();
      await expect(alert.getByRole("combobox")).toBeDisabled();
      releaseResponse();
      await expect(button).toBeEnabled();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(alert.getByRole("alert")).toHaveCount(0);

      await page.reload();
      await alert.getByRole("combobox").selectOption(selectedSku);
      await expect(button).toHaveAttribute("aria-pressed", "true");
      const cancelRequest = page.waitForRequest(
        (request) => new URL(request.url()).pathname === apiPath && request.method() === "DELETE",
      );
      await button.click();
      const cancelled = await cancelRequest;
      expect(cancelled.postDataJSON()).toEqual({ productId, variantSku: selectedSku });
      expect((await cancelled.allHeaders())["x-csrf-token"]).toBe(memberCsrf);
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await page.reload();
      await alert.getByRole("combobox").selectOption(selectedSku);
      await expect(button).toHaveAttribute("aria-pressed", "false");
    } finally {
      releaseResponse();
      try {
        await page.unrouteAll({ behavior: "wait" });
        if (productId) {
          const removed = await page.request.delete(`/api/collections/shop-products/${productId}`, {
            headers: staffHeaders,
          });
          expect(removed.status()).toBe(204);
        }
      } finally {
        try {
          await db.delete(npMembers).where(eq(npMembers.id, memberId));
          if (!detail.enabled) {
            const restored = await page.request.patch("/api/plugins/shop", {
              headers: staffHeaders,
              data: { enabled: false },
            });
            expect(restored.status()).toBe(200);
          }
        } finally {
          await npCloseDbConnection(db);
        }
      }
    }
  });
}

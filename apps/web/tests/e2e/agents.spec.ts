import { expect, test } from "@playwright/test";

import { signInViaForm } from "./fixtures/auth-helpers.js";

test.describe("Agent Studio without a host runtime", () => {
  test("requires staff sign-in and keeps disabled MCP discovery private", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/agents");
    await expect(page).toHaveURL(/\/admin\/login/);
    for (const path of ["/api/mcp", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(404);
    }
  });

  test("shows honest unavailable and empty states across outbound and inbound connections", async ({
    page,
  }) => {
    await signInViaForm(page);
    await page.goto("/admin/agents/connections");
    await expect(
      page.getByRole("status").filter({ hasText: "Agent control-plane mutations are disabled" }),
    ).toBeVisible();
    await expect(
      page.getByText("No provider connections for this site.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Gateway inbound" }).click();
    await expect(
      page.getByText("No external Gateway principals for this site.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create principal", exact: true }),
    ).toBeDisabled();
  });
});

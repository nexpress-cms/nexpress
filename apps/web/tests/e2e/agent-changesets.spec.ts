import { expect, test } from "@playwright/test";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
const id = "11111111-1111-4111-8111-111111111111";
const hash = `cj1:sha256:${"a".repeat(43)}`;
function draft() {
  return {
    schemaVersion: "np.agent-changeset.v1",
    id,
    siteId: "default",
    title: "Review fixture proposal",
    summary: "<script>untrusted assessment</script>",
    state: "draft",
    actor: { id, kind: "staff", name: "Staff" },
    agentId: null,
    agentVersionId: null,
    agentConfigHash: null,
    runId: null,
    planHash: null,
    baseFingerprint: null,
    draftVersion: 1,
    draftHash: hash,
    risk: null,
    operations: [
      {
        ordinal: 1,
        operation: {
          clientOperationId: "op",
          reason: null,
          kind: "document",
          operation: "create",
          resource: { collection: "posts", documentId: null },
          base: null,
          input: { document: { title: "Proposed title" }, targetStatus: "draft" },
        },
        canonicalResourceKey: { kind: "document", collection: "posts", documentId: id },
        beforeHash: null,
        afterHash: null,
        state: "draft",
        issues: [],
        resultDigest: null,
      },
    ],
    validation: null,
    preview: null,
    approval: null,
    schedule: null,
    execution: null,
    verification: null,
    rollback: null,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    expiresAt: "2026-10-08T00:00:00.000Z",
  };
}
test.describe("Agent ChangeSet review", () => {
  test("distinguishes unavailable runtime from empty history", async ({ page }, testInfo) => {
    await isolateE2ERateLimitBucket(page.context(), 180 + testInfo.retry * 3);
    await signInAsE2EAdmin(page);
    await page.goto("/admin/agents/changesets");
    await expect(
      page.getByRole("status").filter({ hasText: "ChangeSet history is unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByText("No authorized ChangeSets on this page.", { exact: true }),
    ).toHaveCount(0);
  });
  test("opens authorized detail, escapes proposal text, and clears evidence on permission loss", async ({
    page,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(page.context(), 181 + testInfo.retry * 3);
    await signInAsE2EAdmin(page);
    let denied = false;
    await page.route("**/api/admin/agents/changesets**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/validate")) {
        denied = true;
        await route.fulfill({
          status: 403,
          json: { error: { code: "FORBIDDEN", message: "Forbidden" }, status: 403 },
        });
        return;
      }
      if (denied) {
        await route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "Not found" }, status: 404 },
        });
        return;
      }
      await route.fulfill({
        json: url.pathname.endsWith(id)
          ? {
              schemaVersion: "np.agent-changeset-review.v1",
              changeSet: draft(),
              requiredStaffCapabilities: ["content.author"],
              operations: [{ ordinal: 1, evidence: "not_validated", fields: [] }],
            }
          : { schemaVersion: "np.agent-changesets.v1", items: [draft()], nextCursor: null },
      });
    });
    await page.goto("/admin/agents/changesets");
    await page.getByRole("link", { name: "Review fixture proposal", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Server facts" })).toBeVisible();
    await expect(
      page.getByText("<script>untrusted assessment</script>", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Diff evidence: not validated", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Generate preview", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Validate proposal", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "no longer have access" }),
    ).toBeVisible();
    await expect(
      page.getByText("<script>untrusted assessment</script>", { exact: true }),
    ).toHaveCount(0);
  });
  test("native launch forms pass the centralized staff CSRF check and retain same-origin intent", async ({
    page,
    context,
  }, testInfo) => {
    await isolateE2ERateLimitBucket(context, 182 + testInfo.retry * 3);
    await signInAsE2EAdmin(page);
    await page.goto("/admin/agents/changesets");
    const endpoint = `/api/admin/agents/changesets/${id}/previews/${id}/launch`;
    const popupPromise = context.waitForEvent("page");
    await page.evaluate((endpoint) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("np-csrf="))
          ?.slice(8) ?? "";
      const form = document.createElement("form");
      form.method = "post";
      form.action = endpoint;
      form.target = "_blank";
      form.rel = "noopener";
      for (const [name, value] of Object.entries({
        command: "{}",
        csrfToken: decodeURIComponent(csrf),
      })) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
      form.remove();
    }, endpoint);
    const popup = await popupPromise;
    await popup.waitForLoadState();
    // No runtime is installed in the reference app; successful CSRF admission reaches its safe 404.
    await expect(popup.locator("body")).toContainText("Not found");
    await expect(popup.locator("body")).not.toContainText("CSRF_INVALID");
    await popup.close();
  });
});

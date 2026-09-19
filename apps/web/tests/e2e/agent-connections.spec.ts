import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  npRequireAgentConnectionV1,
  npRequireAgentStudioOverviewV1,
} from "@nexpress/core/agent-contract";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";

async function tabTo(page: Page, control: Locator) {
  for (let step = 0; step < 80; step++) {
    if (await control.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
}
async function activate(page: Page, control: Locator) {
  await tabTo(page, control);
  await page.keyboard.press("Enter");
}

const id = "11111111-1111-4111-8111-111111111111";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const at = "2026-09-19T00:00:00.000Z";
const connection = npRequireAgentConnectionV1({
  schemaVersion: "np.agent-connection.v1",
  id,
  siteId: "default",
  kind: "model",
  provider: "acceptance-provider",
  adapterId: "acceptance-provider",
  adapterContractVersion: 1,
  adapterFingerprint: digest,
  name: "Keyboard connection",
  authKind: "api_key",
  safeConfig: { modelId: "fixture-model" },
  configVersion: 1,
  configHash: digest,
  pricingCatalogFingerprint: `pc1:sha256:${"C".repeat(43)}`,
  dataProcessingCeiling: "public-only",
  status: "ready",
  credential: { state: "stored", version: 1 },
  verification: { verifiedAt: at, configVersion: 1, credentialVersion: 1, resultDigest: digest },
  lastErrorCode: null,
  dependentAgentCount: 0,
  createdBy: id,
  createdAt: at,
  updatedAt: at,
});
const overview = npRequireAgentStudioOverviewV1({
  schemaVersion: "np.agent-studio-overview.v1",
  siteId: "default",
  runtime: {
    schemaVersion: "np.agent-studio-runtime.v1",
    connections: { state: "ready", issueCode: null },
    gateway: { state: "ready", issueCode: null },
  },
  gatewaySettings: {
    schemaVersion: "np.agent-gateway-settings.v1",
    stdio: "disabled",
    mcpHttp: "disabled",
    agentHttp: "disabled",
  },
  adapters: [
    {
      schemaVersion: "np.agent-studio-adapter.v1",
      id: "acceptance-provider",
      contractVersion: 1,
      fingerprint: digest,
      supportedConnectionKinds: ["model"],
      supportedAuthKinds: ["api_key"],
      configSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        properties: { modelId: { type: "string", maxLength: 128 } },
        required: ["modelId"],
      },
      oauth: null,
    },
  ],
  connections: [],
  principals: [],
});

test("connection keyboard creation preserves retry identity and clears invalid or inaccessible detail", async ({
  page,
}) => {
  await signInAsE2EAdmin(page);
  let releaseOverview!: () => void;
  const ready = new Promise<void>((resolve) => {
    releaseOverview = resolve;
  });
  await page.route("**/api/admin/agents/overview", async (route) => {
    await ready;
    await route.fulfill({ json: overview });
  });
  await page.clock.install();
  const retryAt = new Date(Date.now() + 60_000).toUTCString();
  const creates: Record<string, unknown>[] = [];
  await page.route("**/api/admin/agents/connections", async (route) => {
    creates.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill(
      creates.length === 2
        ? {
            status: 429,
            headers: { "Retry-After": retryAt },
            json: {
              error: { code: "RATE_LIMITED", message: "Wait for the server retry deadline." },
            },
          }
        : creates.length === 1
          ? {
              status: 503,
              json: { status: 503, error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" } },
            }
          : { json: connection },
    );
  });
  let detail: "valid" | "invalid" | "expired" = "valid";
  await page.route(`**/api/admin/agents/connections/${id}`, async (route) => {
    if (detail === "expired") {
      await route.fulfill({
        status: 401,
        json: { error: { code: "UNAUTHENTICATED", message: "Session expired" } },
      });
      return;
    }
    await route.fulfill({
      json: detail === "valid" ? connection : { ...connection, privatePayload: "must-not-render" },
    });
  });
  const revokes: Record<string, unknown>[] = [];
  await page.route(`**/api/admin/agents/connections/${id}/revoke`, async (route) => {
    revokes.push(route.request().postDataJSON() as Record<string, unknown>);
    const status = revokes.length === 1 ? 503 : 403;
    await route.fulfill({
      status,
      json: {
        status,
        error: {
          code: status === 503 ? "SERVICE_UNAVAILABLE" : "FORBIDDEN",
          message: "Unavailable",
        },
      },
    });
  });
  await page.goto("/admin/agents/connections/new");
  await expect(page.getByRole("button", { name: "Save connection" })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
  releaseOverview();
  await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
  await tabTo(page, page.getByLabel("Name", { exact: true }));
  await page.keyboard.insertText("Keyboard connection");
  await tabTo(page, page.getByLabel("Non-secret provider configuration"));
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText('{"modelId":"fixture-model"}');
  await tabTo(page, page.getByLabel("API key (write only)"));
  await page.keyboard.insertText("fixture-credential-never-rendered");
  await activate(page, page.getByRole("button", { name: "Save connection" }));
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("API key (write only)")).toHaveValue("");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Keyboard connection");
  await tabTo(page, page.getByLabel("API key (write only)"));
  await page.keyboard.insertText("fixture-credential-never-rendered");
  await activate(page, page.getByRole("button", { name: "Save connection" }));
  await expect(page.getByRole("status").filter({ hasText: "Wait before retrying" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save connection" })).toBeDisabled();
  await expect(page.getByLabel("API key (write only)")).toHaveValue("");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Keyboard connection");
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "Save connection" })).toBeEnabled();
  expect(creates).toHaveLength(2);
  await page.getByLabel("API key (write only)").fill("fixture-credential-never-rendered");
  await activate(page, page.getByRole("button", { name: "Save connection" }));
  await expect(page).toHaveURL(new RegExp(`/connections/${id}$`));
  expect(creates).toHaveLength(3);
  expect(creates[2]).toEqual(creates[0]);
  expect(creates[1]).toEqual(creates[0]);
  await expect(page.getByRole("heading", { name: "Keyboard connection" })).toBeVisible();
  await expect(page.getByText("fixture-credential-never-rendered")).toHaveCount(0);
  detail = "invalid";
  await activate(page, page.getByRole("button", { name: "Refresh", exact: true }));
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Keyboard connection" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
  await expect(page.getByText("must-not-render")).toHaveCount(0);
  await expect(page.getByText("Loading connection…", { exact: true })).toHaveCount(0);
  detail = "valid";
  await activate(page, page.getByRole("button", { name: "Reload connection" }));
  page.on("dialog", (dialog) => void dialog.accept());
  await activate(page, page.getByRole("button", { name: "Revoke", exact: true }));
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await activate(page, page.getByRole("button", { name: "Reload connection" }));
  await activate(page, page.getByRole("button", { name: "Revoke", exact: true }));
  await expect(page.getByRole("main").getByRole("alert")).toContainText("no longer have access");
  expect(revokes).toHaveLength(2);
  expect(revokes[1]).toEqual(revokes[0]);
  await expect(page.getByRole("heading", { name: "Keyboard connection" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
  detail = "expired";
  await activate(page, page.getByRole("button", { name: "Reload connection" }));
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
    "href",
    /admin\/login/,
  );
  await expect(page.getByRole("heading", { name: "Keyboard connection" })).toHaveCount(0);
});

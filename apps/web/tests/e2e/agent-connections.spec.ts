import { errorDiagnosticsHeaders } from "./fixtures/error-diagnostics.js";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  npRequireAgentConnectionV1,
  npRequireAgentServiceTokenV1,
  npRequireAgentStudioOverviewV1,
} from "@nexpress/core/agent-contract";
import {
  agentLifecycleCheckpoint,
  isAgentLifecycleInteractive,
} from "./fixtures/agent-lifecycle-checkpoint.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";
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
  await expect(page.getByRole("status").filter({ hasText: "Server wait ends" })).toBeVisible();
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

test("connection list and Gateway OAuth partial reads remain usable with bounded localized data", async ({
  page,
}, testInfo) => {
  const connections = Array.from({ length: 50 }, (_, index) => ({
    ...connection,
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    name: `${"긴 한국어 연결 이름과 공급자 검토 ".repeat(3)}${index}`,
  }));
  await page.route("**/api/admin/agents/overview", (route) =>
    route.fulfill({ json: { ...overview, connections } }),
  );
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failed = true;
  let reads = 0;
  await page.route("**/api/admin/agents/gateway/oauth-clients", async (route) => {
    reads++;
    await gate;
    await route.fulfill(
      failed
        ? {
            status: 503,
            json: {
              status: 503,
              error: { code: "SERVICE_UNAVAILABLE", message: "OAuth client list unavailable" },
            },
          }
        : { json: [] },
    );
  });
  await signInAsE2EAdmin(page);
  await page.goto("/admin/agents/connections");
  const cards = page.getByRole("link", { name: /긴 한국어 연결/ });
  await expect(cards).toHaveCount(50);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(colorScheme === "dark");
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await cards.last().click({ trial: true });
      await cards.first().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`connections-${width}-${colorScheme}.png`),
        animations: "disabled",
      });
    }
  }
  await tabTo(page, page.getByRole("tab", { name: "Provider outbound" }));
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Gateway inbound" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Loading OAuth clients" })).toBeVisible();
  await expect(page.getByText("No registered OAuth clients for this site.")).toHaveCount(0);
  release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "OAuth client list unavailable",
  );
  await expect(page.getByRole("button", { name: "Create principal", exact: true })).toBeEnabled();
  await page.clock.install();
  const stopped = reads;
  await page.clock.fastForward(60_000);
  expect(reads).toBe(stopped);
  await page.setViewportSize({ width: 320, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("gateway-oauth-partial-320.png"),
    fullPage: true,
    animations: "disabled",
  });
  failed = false;
  await activate(page, page.getByRole("button", { name: "Reload OAuth clients" }));
  await expect(page.getByText("No registered OAuth clients for this site.")).toBeVisible();
  expect(reads).toBe(stopped + 1);
});

test("Gateway token keyboard issue, one-time disclosure and revocation preserve recovery identity", async ({
  page,
}, testInfo) => {
  const tokenId = "22222222-2222-4222-8222-222222222222";
  const principal = {
    schemaVersion: "np.agent-principal.v1",
    id,
    siteId: "default",
    kind: "external",
    name: "키보드로 검토하는 외부 Gateway 운영 주체",
    description: null,
    status: "active",
    scopes: ["site:read"],
    authority: { kind: "user", userId: id, fingerprint: digest, deletedAt: null },
    rowVersion: 1,
    tokenVersion: 1,
    autonomy: null,
    gatewayExposureCeiling: "read",
    createdAt: at,
    updatedAt: at,
    revokedAt: null,
  };
  const token = {
    schemaVersion: "np.agent-service-token.v1",
    id: tokenId,
    siteId: "default",
    principalId: id,
    name: "긴 한국어 서비스 토큰 이름과 제한된 접근 검토 ".repeat(3).trim(),
    prefix: `npst1_${tokenId}`,
    status: "active_head",
    scopes: ["site:read"],
    transport: "stdio",
    exposureMode: "read",
    audience: "urn:nexpress:agent-gateway:stdio",
    rowVersion: 1,
    expiresAt: "2030-09-27T00:00:00.000Z",
    lastUsedAt: null,
    createdAt: at,
    overlapExpiresAt: null,
    revokedAt: null as string | null,
  };
  npRequireAgentServiceTokenV1(token);
  const secret = `${token.prefix}_${"A".repeat(43)}`;
  let issued = false;
  let expired = false;
  const creates: Record<string, unknown>[] = [];
  const revokes: Record<string, unknown>[] = [];
  await page.route("**/api/admin/agents/overview", (route) =>
    route.fulfill({
      json: {
        ...overview,
        gatewaySettings: { ...overview.gatewaySettings, stdio: "read" },
        principals: [principal],
      },
    }),
  );
  await page.route(`**/api/admin/agents/gateway/principals/${id}`, (route) =>
    route.fulfill(
      expired
        ? {
            status: 401,
            json: { status: 401, error: { code: "UNAUTHENTICATED", message: "Session expired" } },
          }
        : {
            json: {
              schemaVersion: "np.agent-studio-principal-detail.v1",
              principal,
              tokens: issued ? [token] : [],
            },
          },
    ),
  );
  await page.route(`**/api/admin/agents/gateway/principals/${id}/tokens`, (route) => {
    creates.push(route.request().postDataJSON() as Record<string, unknown>);
    if (creates.length === 1)
      return route.fulfill({
        status: 503,
        headers: errorDiagnosticsHeaders(503, "SERVICE_UNAVAILABLE", "check-outcome"),
        json: {
          status: 503,
          error: { code: "SERVICE_UNAVAILABLE", message: "Token issue unavailable" },
        },
      });
    issued = true;
    return route.fulfill({
      json: { schemaVersion: "np.agent-studio-one-time-token.v1", token, value: secret },
    });
  });
  await page.route(
    `**/api/admin/agents/gateway/principals/${id}/tokens/${tokenId}/revoke`,
    (route) => {
      revokes.push(route.request().postDataJSON() as Record<string, unknown>);
      if (revokes.length === 1)
        return route.fulfill({
          status: 503,
          json: {
            status: 503,
            error: { code: "SERVICE_UNAVAILABLE", message: "Token revoke unavailable" },
          },
        });
      token.status = "revoked";
      token.rowVersion++;
      token.revokedAt = at;
      return route.fulfill({ json: token });
    },
  );
  await signInAsE2EAdmin(page);
  await page.goto(`/admin/agents/gateway/${id}`);
  await expect(page.getByText("No tokens issued.", { exact: true })).toBeVisible();
  await tabTo(page, page.getByLabel("Name", { exact: true }));
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(token.name);
  await activate(page, page.getByRole("button", { name: "Create token", exact: true }));
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("The change outcome may be unknown.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { exact: false }),
  ).toBeVisible();
  expect(creates).toHaveLength(1);
  await activate(page, page.getByRole("button", { name: "Reload current state", exact: true }));
  await expect(page.getByRole("button", { name: "Create token", exact: true })).toBeEnabled();
  await activate(page, page.getByRole("button", { name: "Create token", exact: true }));
  await expect(page.getByRole("heading", { name: "Copy this token now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  expect(creates).toHaveLength(2);
  expect(creates[1]).toEqual(creates[0]);
  expect(creates[1]).toMatchObject({
    expectedVersion: 1,
    scopes: ["site:read"],
    transport: "stdio",
    exposure: "read",
  });
  expect(page.url()).not.toContain(secret);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
        .toBe(colorScheme === "dark");
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`gateway-token-${width}-${colorScheme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await activate(page, page.getByRole("button", { name: "Copy token", exact: true }));
  await expect(
    page.getByRole("status").filter({ hasText: "Token copied to clipboard." }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
  await activate(page, page.getByRole("button", { name: "I saved it", exact: true }));
  await expect(page.getByRole("button", { name: "Create token", exact: true })).toBeFocused();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  await activate(page, page.getByRole("button", { name: "Refresh", exact: true }));
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  page.on("dialog", (dialog) => void dialog.accept());
  await activate(page, page.getByRole("button", { name: "Revoke", exact: true }));
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await activate(page, page.getByRole("button", { name: "Reload current state", exact: true }));
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toBeEnabled();
  await activate(page, page.getByRole("button", { name: "Revoke", exact: true }));
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
  expect(revokes).toHaveLength(2);
  expect(revokes[1]).toEqual(revokes[0]);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  expired = true;
  await activate(page, page.getByRole("button", { name: "Refresh", exact: true }));
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText(token.name, { exact: true })).toHaveCount(0);
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
});

test("connection successful revocation waits for confirmed server state and stays terminal", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    240 + testInfo.retry + testInfo.repeatEachIndex * 2,
  );
  await signInAsE2EAdmin(page);
  const revoked = npRequireAgentConnectionV1({
    ...connection,
    status: "revoked",
    credential: { state: "absent" },
    updatedAt: "2026-09-20T00:00:00.000Z",
  });
  let state = connection;
  let detailReads = 0;
  let pending: Route | undefined;
  const writes: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  await page.route("**/api/admin/agents/**", async (route) => {
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort();
  });
  await page.route(`**/api/admin/agents/connections/${id}`, async (route) => {
    expect(route.request().method()).toBe("GET");
    detailReads++;
    await route.fulfill({ json: state });
  });
  await page.route(`**/api/admin/agents/connections/${id}/revoke`, (route) => {
    expect(route.request().method()).toBe("POST");
    writes.push(route.request().postDataJSON() as Record<string, unknown>);
    pending = route;
  });
  await page.goto(`/admin/agents/connections/${id}`);
  const main = page.getByRole("main");
  const revoke = page.getByRole("button", { name: "Revoke", exact: true });
  await expect(revoke).toBeEnabled();
  expect(detailReads).toBe(1);
  await agentLifecycleCheckpoint(
    page,
    "Connection ready: Resume, then CANCEL the native confirmation in interactive mode.",
  );
  if (!isAgentLifecycleInteractive()) {
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toBe(`Revoke ${connection.name}? This is terminal.`);
      await dialog.dismiss();
    });
  }
  await activate(page, revoke);
  await expect(revoke).toBeEnabled();
  expect(writes).toHaveLength(0);
  await expect(main.getByText("ready", { exact: true })).toBeVisible();
  await agentLifecycleCheckpoint(
    page,
    "Connection cancellation retained ready state: Resume, then ACCEPT the native confirmation.",
  );
  if (!isAgentLifecycleInteractive()) page.once("dialog", (dialog) => void dialog.accept());
  await activate(page, revoke);
  await expect.poll(() => pending !== undefined).toBe(true);
  await expect(page.getByRole("button", { name: "Revoking…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await expect(main.getByText("ready", { exact: true })).toBeVisible();
  await expect(main.getByText("revoked", { exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({
    expectedVersion: connection.configVersion,
    idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    reason: "Revoked in Agent Studio",
  });
  await agentLifecycleCheckpoint(
    page,
    "Connection revocation pending: old returned state remains; no second submission is available.",
  );
  state = revoked;
  await pending!.fulfill({ json: revoked });
  await expect(main.getByText("revoked", { exact: true })).toBeVisible();
  await expect(main.getByText("Credential: absent", { exact: true })).toBeVisible();
  await expect(revoke).toBeDisabled();
  await activate(page, page.getByRole("button", { name: "Refresh", exact: true }));
  await expect.poll(() => detailReads).toBe(2);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(main.getByText("revoked", { exact: true })).toBeVisible();
  await expect(revoke).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect(unexpected).toEqual([]);
  await agentLifecycleCheckpoint(
    page,
    "Connection revoked: terminal state survives readback, credential absent, Revoke disabled.",
  );
});

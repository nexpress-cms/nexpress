import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  NP_DEFAULT_SITE_ID,
  createSite,
  grantSiteMembership,
  withCurrentSite,
} from "@nexpress/core";
import {
  createAgentActivityServiceV1,
  createAgentGatewayServiceV1,
  createAgentStudioServerRuntimeV1,
  resetAgentStudioServerRuntimeV1,
  setAgentStudioServerRuntimeV1,
} from "@nexpress/core/agents";
import { GET as runs } from "@/app/api/admin/agents/activity/route";
import { GET as run } from "@/app/api/admin/agents/activity/[id]/route";
import { GET as actions } from "@/app/api/admin/agents/activity/actions/route";
import { GET as action } from "@/app/api/admin/agents/activity/actions/[id]/route";
import {
  GET as principals,
  POST as createPrincipal,
} from "@/app/api/admin/agents/gateway/principals/route";
import { GET as principal } from "@/app/api/admin/agents/gateway/principals/[id]/route";
import { POST as createToken } from "@/app/api/admin/agents/gateway/principals/[id]/tokens/route";
import { POST as suspend } from "@/app/api/admin/agents/gateway/principals/[id]/suspend/route";
import { POST as resume } from "@/app/api/admin/agents/gateway/principals/[id]/resume/route";
import { POST as revoke } from "@/app/api/admin/agents/gateway/principals/[id]/revoke/route";
import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

const root = "/api/admin/agents";
const principalPath = `${root}/gateway/principals`;
const missingId = "11111111-1111-4111-8111-111111111111";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const readRoutes = [runs, actions, principals];
function install(reauthenticated = true) {
  const gateway = createAgentGatewayServiceV1({
    tokenHashKeyring: { active: { id: "activity-test", key: new Uint8Array(32).fill(19) } },
    environment: "production",
    deploymentGatewaySettings: {
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "read",
      mcpHttp: "disabled",
      agentHttp: "disabled",
    },
    resolveSiteGatewaySettings: () => ({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "read",
      mcpHttp: "disabled",
      agentHttp: "disabled",
    }),
    reauthentication: { verify: () => reauthenticated },
  });
  return setAgentStudioServerRuntimeV1(
    createAgentStudioServerRuntimeV1({
      gateway,
      activity: createAgentActivityServiceV1({ cursorHmacKey: new Uint8Array(32).fill(17) }),
    }),
  );
}
async function create(session: TestUserSession) {
  const response = await createPrincipal(
    buildRequest(principalPath, {
      session,
      method: "POST",
      body: {
        idempotencyKey: crypto.randomUUID(),
        name: "Activity reader",
        description: null,
        scopes: ["site:read"],
      },
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; rowVersion: number; status: string };
}

describe.skipIf(skipIfNoTestDb())("Agent Activity Admin routes", () => {
  beforeAll(ensureMigrated);
  afterEach(async () => {
    resetAgentStudioServerRuntimeV1();
    await truncateAll();
  });
  afterAll(closeTestDb);

  it("requires current staff authority before runtime access and reports unavailable honestly", async () => {
    for (const route of readRoutes) {
      const response = await route(buildRequest(root));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const editor = await seedUser({ role: "editor" });
    expect((await runs(buildRequest(root, { session: editor }))).status).toBe(403);
    const admin = await seedUser();
    expect((await runs(buildRequest(root, { session: admin }))).status).toBe(503);
    install();
    for (const route of readRoutes) {
      const response = await route(buildRequest(root, { session: admin }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ items: [], nextCursor: null });
    }
  });

  it("decodes only bounded exact queries without duplicate or prototype key fallback", async () => {
    install();
    const session = await seedUser();
    expect(
      (
        await runs(
          buildRequest(`${root}/activity?limit=25&origin=gateway&capabilityId=site.inspect`, {
            session,
          }),
        )
      ).status,
    ).toBe(200);
    for (const query of [
      "limit=01",
      "limit=101",
      "limit=2&limit=3",
      "siteId=other",
      "__proto__=polluted",
      "constructor=x",
      "state=complete",
      "kind=external",
      "from=2026-02-30T00%3A00%3A00.000Z",
    ]) {
      const response = await runs(buildRequest(`${root}/activity?${query}`, { session }));
      expect(response.status, query).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(
      (await actions(buildRequest(`${root}/activity/actions?origin=gateway`, { session }))).status,
    ).toBe(400);
    expect(
      (await principals(buildRequest(`${principalPath}?principalId=${missingId}`, { session })))
        .status,
    ).toBe(400);
  });

  it("uses the same missing response for absent and cross-site principals, runs, and actions", async () => {
    install();
    const session = await seedUser();
    const item = await create(session);
    const visible = await principal(
      buildRequest(`${principalPath}/${item.id}`, { session }),
      params(item.id),
    );
    expect(visible.status).toBe(200);
    const page = await principals(buildRequest(principalPath, { session }));
    expect(await page.json()).toMatchObject({
      items: [{ id: item.id, siteId: NP_DEFAULT_SITE_ID }],
    });
    await createSite({ id: "activity-other", name: "Other activity" });
    await grantSiteMembership("activity-other", session.userId, "admin");
    const absent = await principal(
      buildRequest(`${principalPath}/${missingId}`, { session }),
      params(missingId),
    );
    const foreign = await withCurrentSite("activity-other", () =>
      principal(buildRequest(`${principalPath}/${item.id}`, { session }), params(item.id)),
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await absent.json());
    for (const route of [run, action]) {
      const response = await route(buildRequest(root, { session }), params(missingId));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain(missingId);
    }
  });

  it("reuses reauthentication, idempotency and CAS for principal suspend/resume/revoke", async () => {
    install();
    const session = await seedUser();
    const item = await create(session);
    const token = await createToken(
      buildRequest(`${principalPath}/${item.id}/tokens`, {
        session,
        method: "POST",
        body: {
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: item.rowVersion,
          name: "Activity lifecycle fixture",
          scopes: ["site:read"],
          transport: "stdio",
          exposure: "read",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      }),
      params(item.id),
    );
    expect(token.status).toBe(201);
    // Token creation advances its parent principal version; resume requires this live credential.
    const ready = await principal(
      buildRequest(`${principalPath}/${item.id}`, { session }),
      params(item.id),
    );
    const version = ((await ready.json()) as { principal: { rowVersion: number } }).principal
      .rowVersion;
    const command = {
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: version,
      reason: "Review access",
    };
    const request = (operation: string, body: unknown, headers?: Record<string, string>) =>
      buildRequest(`${principalPath}/${item.id}/${operation}`, {
        session,
        method: "POST",
        body,
        headers,
      });
    install(false);
    const suspended = await suspend(request("suspend", command), params(item.id));
    expect(suspended.status).toBe(200);
    expect(await suspended.json()).toMatchObject({ status: "suspended", rowVersion: version + 1 });
    expect((await suspend(request("suspend", command), params(item.id))).status).toBe(200);
    expect(
      (
        await resume(
          request("resume", { idempotencyKey: crypto.randomUUID(), expectedVersion: version }),
          params(item.id),
        )
      ).status,
    ).toBe(409);
    const resumed = await resume(
      request("resume", { idempotencyKey: crypto.randomUUID(), expectedVersion: version + 1 }),
      params(item.id),
    );
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ status: "active", rowVersion: version + 2 });
    const revokeCommand = {
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: version + 2,
      reason: "Retire access",
    };
    // Revoke has the existing recent-staff-primary floor; suspend/resume do not.
    expect((await revoke(request("revoke", revokeCommand), params(item.id))).status).toBe(403);
    install();
    const revoked = await revoke(request("revoke", revokeCommand), params(item.id));
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ status: "revoked", rowVersion: version + 3 });
  });
});

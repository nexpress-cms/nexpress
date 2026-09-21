import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { npApiErrorDiagnosticsHeader } from "@nexpress/core/api-contract";
import { NpAuthError, NpForbiddenError } from "@nexpress/core";
import {
  npAgentRuntimeAdminOperationIdsV1,
  npBuildAgentPolicySimulationFixtureInputV1,
  npSimulateAgentPolicyV1,
  npCreateDisabledAgentRuntimeSettingsV1,
  npGetAgentAdminOperationV1,
} from "@nexpress/core/agent-contract";
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  staff: vi.fn(),
  ensure: vi.fn(),
  listConfigurations: vi.fn(),
  listPolicies: vi.fn(),
  listTriggers: vi.fn(),
  getConfiguration: vi.fn(),
  getPolicy: vi.fn(),
  getEffective: vi.fn(),
  getCatalog: vi.fn(),
  getBudget: vi.fn(),
  getStatus: vi.fn(),
  executeAdmin: vi.fn(),
}));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.runtime,
}));
vi.mock("./studio-admin", () => ({
  requireAgentStudioAdmin: mocks.staff,
  normalizeAgentStudioError: (error: unknown) => error,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensure }));
import { handleAgentRuntimeAdminRequest } from "./runtime-admin";
const id = "10000000-0000-4000-8000-000000000001";
const staff = { siteId: "default", actor: { user: { id }, sessionId: id } };
const request = (query = "", body?: unknown) =>
  new NextRequest(
    `https://site.example/api/admin/agents/configurations${query}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
const mutationIds = npAgentRuntimeAdminOperationIdsV1.filter(
  (id) => id !== "agents.policies.simulate",
);
const reads = [
  ["configurations", "listConfigurations"],
  ["policies", "listPolicies"],
  ["triggers", "listTriggers"],
  ["configuration", "getConfiguration"],
  ["policy", "getPolicy"],
  ["effective", "getEffective"],
  ["catalog", "getCatalog"],
  ["budget", "getBudget"],
  ["status", "getStatus"],
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue(staff);
  mocks.runtime.mockReturnValue({ runtimeStudio: mocks });
  mocks.executeAdmin.mockResolvedValue({
    resourceId: id,
    replayed: false,
    output: { rawBody: "private-output", credential: "private-credential" },
    invocationId: id,
  });
});
describe("Runtime Studio shared HTTP admission", () => {
  it("declares recovery from the operation contract, never the supplied HTTP method", async () => {
    mocks.runtime.mockReturnValue(undefined);
    const read = await handleAgentRuntimeAdminRequest(request("", {}), "configurations");
    const mutation = await handleAgentRuntimeAdminRequest(
      request(),
      "agents.configurations.run",
      id,
    );
    expect(read.status).toBe(503);
    expect(JSON.parse(read.headers.get(npApiErrorDiagnosticsHeader)!)).toMatchObject({
      recovery: "retry-read",
    });
    expect(mutation.status).toBe(503);
    expect(JSON.parse(mutation.headers.get(npApiErrorDiagnosticsHeader)!)).toMatchObject({
      recovery: "check-outcome",
    });
    expect(mocks.executeAdmin).not.toHaveBeenCalled();
  });
  it.each([new NpAuthError(), new NpForbiddenError("agent-studio", "manage")])(
    "checks current staff before resolving installed management",
    async (error) => {
      mocks.staff.mockRejectedValue(error);
      const response = await handleAgentRuntimeAdminRequest(request(), "configurations");
      expect(response.status).toBe(error.statusCode);
      expect(mocks.runtime).not.toHaveBeenCalled();
      expect(mocks.listConfigurations).not.toHaveBeenCalled();
    },
  );
  // Installation is checked once before dispatch. Exercise read, mutation and
  // simulation entry paths; the route inventory separately verifies every export.
  it.each([
    { operation: "configurations", runtime: null },
    { operation: "agents.configurations.create", runtime: { runtimeStudio: null } },
    { operation: "agents.policies.simulate", runtime: null },
  ] as const)(
    "keeps unavailable $operation distinct from an empty result",
    async ({ operation, runtime }) => {
      mocks.runtime.mockReturnValue(runtime);
      const response = await handleAgentRuntimeAdminRequest(request(), operation, id);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(mocks.listConfigurations).not.toHaveBeenCalled();
      expect(mocks.executeAdmin).not.toHaveBeenCalled();
    },
  );
  it("passes bounded filters with the server-selected staff site", async () => {
    mocks.listConfigurations.mockResolvedValue({
      schemaVersion: "np.agent-configurations-page.v1",
      items: [],
      nextCursor: null,
    });
    const response = await handleAgentRuntimeAdminRequest(
      request("?limit=5&status=paused&template=operator"),
      "configurations",
    );
    expect(response.status).toBe(200);
    expect(mocks.ensure).toHaveBeenCalledWith("read");
    expect(mocks.listConfigurations).toHaveBeenCalledWith({
      ...staff,
      query: { limit: 5, status: "paused", template: "operator" },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it.each([
    "?limit=0",
    "?limit=101",
    "?limit=01",
    "?limit=1&limit=1",
    "?siteId=other",
    "?cursor=",
    "?status=retired",
    "?unknown=value",
    "?__proto__=value",
    "?cursor=" + "x".repeat(8192),
  ])("rejects malformed or non-inventory query %s before service dispatch", async (query) => {
    const response = await handleAgentRuntimeAdminRequest(request(query), "configurations");
    expect(response.status).toBe(400);
    expect(mocks.listConfigurations).not.toHaveBeenCalled();
  });
  it("allows only active-version review selector and prohibits detail query injection", async () => {
    mocks.getEffective.mockRejectedValue(new Error("private error"));
    await handleAgentRuntimeAdminRequest(request("?version=active"), "effective", id);
    expect(mocks.getEffective).toHaveBeenCalledWith({ ...staff, id, version: "active" });
    mocks.getEffective.mockClear();
    for (const query of ["?version=draft", "?version=active&version=active", "?versionId=" + id])
      expect((await handleAgentRuntimeAdminRequest(request(query), "effective", id)).status).toBe(
        400,
      );
    expect(mocks.getEffective).not.toHaveBeenCalled();
    expect(
      (await handleAgentRuntimeAdminRequest(request("?siteId=other"), "configuration", id)).status,
    ).toBe(400);
    expect(mocks.getConfiguration).not.toHaveBeenCalled();
  });
  it.each(reads)("rejects unvalidated private %s output", async (operation, method) => {
    mocks[method].mockResolvedValue({
      rawBody: "private-body",
      locator: "private-locator",
      credential: "private-credential",
    });
    const response = await handleAgentRuntimeAdminRequest(request(), operation, id);
    expect(response.status).toBe(500);
    const text = await response.text();
    for (const secret of ["private-body", "private-locator", "private-credential"])
      expect(text).not.toContain(secret);
  });
  it.each(mutationIds.map((operationId) => ({ operationId })))(
    "delegates $operationId through the exact existing operation and projects only acknowledgement",
    async ({ operationId }) => {
      const values: Record<string, unknown> = {
        idempotencyKey: "runtime-http-attempt",
        expectedVersion: 1,
        definitionJson: "{}",
        definitionHash: `cj1:sha256:${"A".repeat(43)}`,
        configHash: `cj1:sha256:${"A".repeat(43)}`,
        inputJson: "{}",
        triggerId: id,
        reason: "Operator action",
      };
      const required = npGetAgentAdminOperationV1(operationId).schemas.input.schema.required;
      if (
        !Array.isArray(required) ||
        !required.every((key): key is string => typeof key === "string")
      )
        throw new Error("Missing exact command fields");
      const command = Object.fromEntries(required.map((key) => [key, values[key]]));
      const targetId = operationId.endsWith(".create") ? undefined : id;
      const response = await handleAgentRuntimeAdminRequest(
        request("", command),
        operationId,
        targetId,
      );
      expect(mocks.ensure).toHaveBeenCalledWith("write");
      expect(mocks.executeAdmin).toHaveBeenCalledWith({
        ...staff,
        operationId,
        targetId: targetId ?? null,
        command,
      });
      expect(response.status).toBe(
        operationId.endsWith(".create") || operationId === "agents.configurations.run" ? 201 : 200,
      );
      const body = await response.json();
      expect(body).toEqual({ resourceId: id, replayed: false });
      expect(JSON.stringify(body)).not.toMatch(
        /private-output|private-credential|invocationId|rawBody/,
      );
    },
  );
  it("returns only an exact owned simulation report and rejects leaked or malformed host results", async () => {
    const fixture = await npBuildAgentPolicySimulationFixtureInputV1();
    const report = npSimulateAgentPolicyV1({
      policyId: id,
      policyVersion: 1,
      policyHash: `cj1:sha256:${"A".repeat(43)}`,
      fixtureHash: fixture.fixtureHash,
      layers: [npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules],
    });
    const body = {
      idempotencyKey: "simulation-http",
      expectedVersion: 1,
      configHash: report.policyHash,
      ...fixture,
    };
    mocks.executeAdmin.mockResolvedValue({ resourceId: id, replayed: false, output: report });
    const response = await handleAgentRuntimeAdminRequest(
      request("", body),
      "agents.policies.simulate",
      id,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
    expect(mocks.ensure).toHaveBeenCalledWith("write");
    for (const patch of [
      { policyId: "20000000-0000-4000-8000-000000000002" },
      { policyHash: `cj1:sha256:${"B".repeat(43)}` },
      { fixtureHash: `cj1:sha256:${"B".repeat(43)}` },
    ]) {
      mocks.executeAdmin.mockResolvedValue({
        resourceId: id,
        replayed: false,
        output: { ...report, ...patch },
      });
      expect(
        (await handleAgentRuntimeAdminRequest(request("", body), "agents.policies.simulate", id))
          .status,
      ).toBe(500);
    }
    mocks.executeAdmin.mockResolvedValue({
      resourceId: id,
      replayed: false,
      output: { ...report, rawBody: "private-body" },
    });
    const rejected = await handleAgentRuntimeAdminRequest(
      request("", body),
      "agents.policies.simulate",
      id,
    );
    expect(rejected.status).toBe(500);
    expect(await rejected.text()).not.toContain("private-body");
  });
  it("rejects unknown mutation fields before admission dispatch", async () => {
    const response = await handleAgentRuntimeAdminRequest(
      request("", {
        idempotencyKey: "test",
        definitionJson: "{}",
        definitionHash: `cj1:sha256:${"A".repeat(43)}`,
        siteId: "other",
      }),
      "agents.configurations.create",
    );
    expect(response.status).toBe(400);
    expect(mocks.executeAdmin).not.toHaveBeenCalled();
  });
  it("rejects incomplete simulation and malformed or oversized JSON", async () => {
    expect(
      (await handleAgentRuntimeAdminRequest(request("", {}), "agents.policies.simulate", id))
        .status,
    ).toBe(400);
    expect(mocks.executeAdmin).not.toHaveBeenCalled();
    for (const body of ["{", JSON.stringify({ input: "x".repeat(1_048_577) })]) {
      const response = await handleAgentRuntimeAdminRequest(
        new NextRequest("https://site.example/api/admin/agents/configurations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        "agents.configurations.create",
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect(mocks.executeAdmin).not.toHaveBeenCalled();
  });
  it("conceals unknown internal failures and invalid acknowledgements", async () => {
    mocks.executeAdmin.mockResolvedValue({ resourceId: "private-locator", replayed: false });
    const invalid = await handleAgentRuntimeAdminRequest(
      request("", {
        idempotencyKey: "test-create",
        definitionJson: "{}",
        definitionHash: `cj1:sha256:${"A".repeat(43)}`,
      }),
      "agents.configurations.create",
    );
    expect(invalid.status).toBe(500);
    expect(await invalid.text()).not.toContain("private-locator");
    mocks.executeAdmin.mockRejectedValue(new Error("private-provider-token"));
    const failed = await handleAgentRuntimeAdminRequest(
      request("", {
        idempotencyKey: "test-create",
        definitionJson: "{}",
        definitionHash: `cj1:sha256:${"A".repeat(43)}`,
      }),
      "agents.configurations.create",
    );
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("private-provider-token");
  });
});

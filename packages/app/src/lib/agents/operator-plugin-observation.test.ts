import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { getAllPluginIds, getPluginRegistration } from "@nexpress/core";
import { loadPlugins, resetPlugins } from "@nexpress/core/bootstrap";
import type { NpAgentOperatorHostContextV1 } from "@nexpress/core/agents";
import { npCreateAgentOperatorAppHostV1 } from "./operator-host";

// The host's unrelated health module imports the framework-host bootstrap alias.
// Plugin collection must not read it; the real registry and diagnostic owner stay intact.
vi.mock("../db", () => ({
  getDb: () => {
    throw new Error("Unexpected DB access");
  },
}));

const uuid = "01900000-0000-7000-8000-000000000010";
const context: NpAgentOperatorHostContextV1 = {
  // Plugin observations must never connect to this unused DB handle.
  db: drizzle(new Client()),
  siteId: "default",
  principal: {
    kind: "service",
    principalId: uuid,
    siteId: "default",
    authority: { kind: "user", userId: uuid },
    credentialId: uuid,
    gatewayExposureCeiling: "read",
    scopes: ["ops:read", "audit:run"],
  },
  requestedAt: "2026-09-30T00:00:00.000Z",
  invocationId: uuid,
  idempotencyKey: null,
  abortSignal: new AbortController().signal,
};
const input = { families: ["plugins" as const], collections: [], maxTargets: 1 };
const fixture = (id: string) => ({
  manifest: { id, name: "Private deployment plugin", version: "0.1.0", capabilities: [] },
});

beforeEach(() => resetPlugins());
afterEach(() => resetPlugins());

describe("Operator actual plugin registry observation", () => {
  it("retains bounded registry diagnostics without exposing plugin metadata or claiming code security", async () => {
    await loadPlugins([fixture("operator-plugin-private")]);
    expect(getAllPluginIds()).toEqual(["operator-plugin-private"]);
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(true),
      observationOwners: { plugins: true },
    });
    const audit = await host.audit!({ ...context, auditId: uuid, input });
    expect(audit.checks[0]).toMatchObject({ family: "plugins", status: "pass" });
    expect(audit.checks[0]?.evidenceRefs).toEqual(
      expect.arrayContaining([
        "basis:deployment-runtime-registry",
        "complete:true",
        "fact:plugins:1",
        "fact:errors:0",
      ]),
    );
    const registration = getPluginRegistration("operator-plugin-private");
    if (!registration) throw new Error("Fixture registry missing");
    registration.discovery.agent.tags.push("duplicate", "duplicate");
    const invalid = await host.audit!({ ...context, auditId: uuid, input });
    expect(invalid.checks[0]).toMatchObject({ status: "fail" });
    expect(invalid.checks[0]?.evidenceRefs).toContain("fact:errors:1");
    const status = await host.status({ families: ["plugins"] }, context);
    expect(status.report.checks[0]?.detail).toContain(
      "not plugin code security or external connectivity",
    );
    expect(JSON.stringify({ audit, invalid, status })).not.toMatch(
      /operator-plugin-private|Private deployment plugin|duplicate/,
    );
  });

  it("reports unknown completeness when installed registry exceeds the selected entity budget", async () => {
    await loadPlugins([fixture("operator-first"), fixture("operator-second")]);
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(true),
      observationOwners: { plugins: true },
    });
    const audit = await host.audit!({ ...context, auditId: uuid, input });
    expect(audit.checks[0]).toMatchObject({ status: "warn" });
    expect(audit.checks[0]?.evidenceRefs).toContain("state:bounded-out");
    expect(audit.checks[0]?.evidenceRefs).toContain("complete:false");
    expect(audit.checks[0]?.evidenceRefs).not.toContain("fact:errors:0");
  });

  it("rechecks deployment authority for fresh audit, status and retained-audit access", async () => {
    await loadPlugins([fixture("operator-authority")]);
    let allowed = true;
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(allowed),
      observationOwners: { plugins: true },
    });
    await host.audit!({ ...context, auditId: uuid, input });
    allowed = false;
    await expect(host.audit!({ ...context, auditId: uuid, input })).rejects.toThrow("unavailable");
    await expect(
      host.assertAccess({ ...context, capabilityId: "audit.run", input }),
    ).rejects.toThrow("unavailable");
    const status = await host.status({ families: ["plugins"] }, context);
    expect(status.report.checks[0]?.detail).toBe("Scoped evidence is unavailable.");

    let checks = 0;
    const revokedDuringObservation = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(++checks === 1),
      observationOwners: { plugins: true },
    });
    await expect(
      revokedDuringObservation.audit!({ ...context, auditId: uuid, input }),
    ).rejects.toThrow("unavailable");
    checks = 0;
    const redacted = await revokedDuringObservation.status({ families: ["plugins"] }, context);
    expect(redacted.report.checks[0]?.detail).toBe("Scoped evidence is unavailable.");
  });
});

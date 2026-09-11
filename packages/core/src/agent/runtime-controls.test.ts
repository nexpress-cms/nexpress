import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../agent-contract/runtime-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  createAgentRuntimeControlsV1,
  npValidateAgentRuntimeControlStateV1,
} from "./runtime-controls.js";

const digest = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(domain).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const actor = digest("test.actor", "local-deployment");
function paused() {
  return {
    ...npCreateDisabledAgentRuntimeSettingsV1(),
    enabled: true,
    emergencyPause: {
      paused: true,
      reasonCode: "OPERATOR_REQUESTED",
      actorFingerprint: actor,
      changedAt: "2026-09-11T00:00:00.000Z",
    },
  };
}
function prepared() {
  const body = {
    schemaVersion: "np.agent-runtime-resume-plan.v1",
    id: "00000000-0000-4000-8000-000000000001",
    siteId: "default",
    actorFingerprint: actor,
    revision: 1,
    settingsHash: digest("np.agent-runtime-settings.v1", paused()),
    readinessFingerprint: digest("test.readiness", "ready"),
    issuedAt: "2026-09-11T00:00:00.000Z",
    expiresAt: "2026-09-11T00:05:00.000Z",
  };
  return { ...body, planHash: digest("np.agent-runtime-resume-plan.v1", body) };
}
describe("runtime controls integrity", () => {
  it("checks the same live dependencies while allowing repair under disabled or paused settings", async () => {
    let settings = npCreateDisabledAgentRuntimeSettingsV1();
    const db = {
      execute: vi.fn(() => Promise.resolve(undefined)),
      select: () => {
        let rows: unknown[] = [];
        const query = {
          from(table: PgTable) {
            rows =
              getTableName(table) === "np_sites"
                ? [{ id: "default" }]
                : getTableName(table) === "np_settings"
                  ? [{ key: "agents.runtime", value: settings }]
                  : [];
            return query;
          },
          where() {
            return query;
          },
          for() {
            return query;
          },
          limit: () => Promise.resolve(rows),
          then(resolve: (rows: unknown[]) => unknown) {
            return Promise.resolve(rows).then(resolve);
          },
        };
        return query;
      },
    } as unknown as Parameters<
      ReturnType<typeof createAgentRuntimeControlsV1>["requireReadyInTransaction"]
    >[0]["db"];
    const readiness = vi.fn(() =>
      Promise.resolve({
        checks: {
          doctor: "ready",
          policy: "ready",
          budget: "ready",
          vault: "not-required",
          integrityKey: "ready",
          worker: "ready",
        } as const,
        fingerprint: actor,
      }),
    );
    const controls = createAgentRuntimeControlsV1({ readiness });
    await expect(
      controls.requireDependenciesReadyInTransaction({ db, siteId: "default" }),
    ).resolves.toBeUndefined();
    await expect(
      controls.requireReadyInTransaction({ db, siteId: "default" }),
    ).rejects.toMatchObject({ code: "RUNTIME_READINESS_BLOCKED" });
    settings = paused();
    await expect(
      controls.requireDependenciesReadyInTransaction({ db, siteId: "default" }),
    ).resolves.toBeUndefined();
    await expect(
      controls.requireReadyInTransaction({ db, siteId: "default" }),
    ).rejects.toMatchObject({ code: "RUNTIME_READINESS_BLOCKED" });
    expect(readiness).toHaveBeenCalledTimes(2);
    await expect(
      createAgentRuntimeControlsV1().requireDependenciesReadyInTransaction({
        db,
        siteId: "default",
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_READINESS_BLOCKED" });
  });
  it("requires configured local deployment authority before touching the database", () => {
    expect(() => createAgentRuntimeControlsV1().status({ siteId: "default" })).toThrow(
      "RUNTIME_AUTHORITY_REQUIRED",
    );
    expect(() =>
      createAgentRuntimeControlsV1().pause({ siteId: "default", reason: "maintenance" }),
    ).toThrow("RUNTIME_AUTHORITY_REQUIRED");
    expect(() =>
      createAgentRuntimeControlsV1({ deploymentActorFingerprint: "operator@example.com" }),
    ).toThrow("RUNTIME_AUTHORITY_REQUIRED");
  });
  it("accepts exactly the persisted plan bound to current site and paused settings", () => {
    const input = {
      siteId: "default",
      settings: paused(),
      control: { revision: 1, currentResumePlan: prepared(), lastResumeReceipt: null },
    };
    expect(npValidateAgentRuntimeControlStateV1(input)).toBe(true);
    expect(npValidateAgentRuntimeControlStateV1({ ...input, siteId: "other" })).toBe(false);
    expect(
      npValidateAgentRuntimeControlStateV1({
        ...input,
        settings: { ...paused(), allowedProviderIds: ["different-provider"] },
      }),
    ).toBe(false);
    expect(
      npValidateAgentRuntimeControlStateV1({
        ...input,
        control: {
          ...input.control,
          currentResumePlan: { ...prepared(), actorFingerprint: digest("test.actor", "another") },
        },
      }),
    ).toBe(false);
  });
  it("does not accept an old consumed receipt after a new configuration revision", () => {
    const settings = {
      ...paused(),
      emergencyPause: { paused: false, reasonCode: null, actorFingerprint: null, changedAt: null },
    };
    const receipt = {
      plan: prepared(),
      revision: 2,
      settingsHash: digest("np.agent-runtime-settings.v1", settings),
      completedAt: "2026-09-11T00:01:00.000Z",
    };
    expect(
      npValidateAgentRuntimeControlStateV1({
        siteId: "default",
        settings,
        control: { revision: 2, currentResumePlan: null, lastResumeReceipt: receipt },
      }),
    ).toBe(true);
    expect(
      npValidateAgentRuntimeControlStateV1({
        siteId: "default",
        settings,
        control: { revision: 3, currentResumePlan: null, lastResumeReceipt: receipt },
      }),
    ).toBe(false);
  });
});

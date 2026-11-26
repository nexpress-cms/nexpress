import { createHash } from "node:crypto";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "../db/runtime.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentGuardianControlV1,
  npRequireAgentGuardianEnablePlanV1,
} from "../agent-contract/guardian-controls-contract.js";
import {
  createAgentGuardianControlsV1,
  npReadAgentGuardianCaptureAdmissionFromRetainedRowV1,
  type NpAgentGuardianControlRegistrationV1,
} from "./guardian-controls.js";
import { npReadAgentGuardianCaptureAdmissionFromRetainedRowV1 as readSafeRetainedAdmission } from "./guardian-capture-admission.js";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db/runtime.js", () => ({ getDb: mocks.getDb }));
const hash = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(domain).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const actor = hash("actor", "local"),
  otherActor = hash("actor", "other"),
  registrationHash = hash("registration", 1);
function fixture() {
  const state = {
    value: undefined as unknown,
    clock: new Date("2026-10-18T00:00:00.000Z"),
    audit: [] as unknown[],
    failAudit: false,
    siteExists: true,
    deleting: false,
    registration: {
      sourceCount: 1,
      ready: true,
      fingerprint: registrationHash,
    } as NpAgentGuardianControlRegistrationV1,
  };
  const execute = vi.fn(() => Promise.resolve({ rows: [{ statement_ms: 0, lock_ms: 0 }] }));
  const select = vi.fn(() => {
    let rows: unknown[] = [];
    const query = {
      from(table: PgTable) {
        const name = getTableName(table);
        rows =
          name === "np_sites"
            ? state.siteExists
              ? [{ id: "default" }]
              : []
            : name === "np_agent_site_deletion_sagas"
              ? state.deleting
                ? [{ id: "deleting" }]
                : []
              : name === "np_settings"
                ? state.value === undefined
                  ? []
                  : [{ value: state.value }]
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
    };
    return query;
  });
  const db = {
    execute,
    select,
    insert(table: PgTable) {
      return {
        values(value: unknown) {
          if (getTableName(table) === "np_settings")
            return {
              onConflictDoUpdate: () => {
                state.value = (value as { value: unknown }).value;
                return Promise.resolve();
              },
            };
          if (state.failAudit) return Promise.reject(new Error("private-audit-failure-marker"));
          state.audit.push(value);
          return Promise.resolve();
        },
      };
    },
    transaction: async <T>(work: (db: ReturnType<typeof getDb>) => Promise<T>) => {
      const value = structuredClone(state.value),
        audit = structuredClone(state.audit);
      try {
        return await work(db);
      } catch (error) {
        state.value = value;
        state.audit = audit;
        throw error;
      }
    },
  } as unknown as ReturnType<typeof getDb>;
  mocks.getDb.mockReturnValue(db);
  const registration = vi.fn(() => Promise.resolve({ ...state.registration }));
  const options = {
    deploymentActorFingerprint: actor,
    registration,
    now: () => new Date(state.clock),
  };
  const controls = createAgentGuardianControlsV1(options);
  const input = { db, siteId: "default", sourceInstalled: true };
  async function plan() {
    await controls.disable({ siteId: "default", reason: "Contain capture" });
    const result = await controls.prepareEnable({ siteId: "default" });
    if (!result.plan) throw new Error("Expected plan");
    return result.plan;
  }
  return { state, execute, select, db, registration, options, controls, input, plan };
}
beforeEach(() => mocks.getDb.mockReset());
describe("independent Guardian local controls", () => {
  it("retains explicit host registration authority without a control row or locks", async () => {
    const f = fixture();
    const result = await f.controls.readCaptureAdmission(f.input);
    expect(result).toMatchObject({
      state: "enabled-by-registration",
      reason: "HOST_REGISTRATION",
      configured: false,
      revision: 0,
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.registration).not.toHaveBeenCalled();
  });
  it("skips absent owners without reading or inventing persisted control metadata", async () => {
    const f = fixture();
    f.state.value = null;
    expect(
      await f.controls.readCaptureAdmission({ ...f.input, sourceInstalled: false }),
    ).toMatchObject({
      state: "disabled",
      reason: "SOURCE_ABSENT",
      configured: null,
      revision: null,
      controlDigest: null,
    });
    expect(f.select).not.toHaveBeenCalled();
  });
  it("projects retained rows identically without loading DB or probing installation", async () => {
    const f = fixture();
    for (const value of [
      undefined,
      {
        schemaVersion: "np.agent-guardian-control.v1",
        revision: 1,
        enabled: false,
        currentEnablePlan: null,
        lastEnableReceipt: null,
      },
    ]) {
      f.state.value = value;
      const retained = npReadAgentGuardianCaptureAdmissionFromRetainedRowV1(
        "default",
        value === undefined ? undefined : { value },
      );
      expect(retained).toEqual(await f.controls.readCaptureAdmission(f.input));
      expect(
        readSafeRetainedAdmission("default", value === undefined ? undefined : { value }),
      ).toEqual(retained);
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(f.registration).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("rejects present null or malformed rows and safely maps the same owner errors", () => {
    expect(
      npReadAgentGuardianCaptureAdmissionFromRetainedRowV1("default", undefined),
    ).toMatchObject({
      configured: false,
      revision: 0,
      state: "enabled-by-registration",
    });
    for (const value of [null, undefined, { enabled: false }]) {
      expect(() =>
        npReadAgentGuardianCaptureAdmissionFromRetainedRowV1("default", { value }),
      ).toThrowError(expect.objectContaining({ code: "GUARDIAN_STATE_INVALID" }));
      expect(() => readSafeRetainedAdmission("default", { value })).toThrowError(
        expect.objectContaining({ code: "GUARDIAN_STATE_INVALID", status: 503 }),
      );
    }
    expect(() => readSafeRetainedAdmission("../private-site-marker", undefined)).toThrowError(
      expect.objectContaining({ code: "GUARDIAN_ARGUMENT_INVALID", status: 503 }),
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("keeps persisted enable-plan site and integrity bindings on retained projections", async () => {
    const f = fixture(),
      plan = await f.plan(),
      row = { value: f.state.value };
    expect(readSafeRetainedAdmission("default", row)).toMatchObject({
      state: "disabled",
      revision: plan.revision,
    });
    expect(() => readSafeRetainedAdmission("other-site", row)).toThrowError(
      expect.objectContaining({ code: "GUARDIAN_STATE_INVALID", status: 503 }),
    );
    const control = npRequireAgentGuardianControlV1(row.value);
    expect(() =>
      readSafeRetainedAdmission("default", {
        value: { ...control, currentEnablePlan: { ...plan, planHash: hash("forged", 1) } },
      }),
    ).toThrowError(expect.objectContaining({ code: "GUARDIAN_STATE_INVALID", status: 503 }));
  });
  it("requires local deployment authority before opening a DB transaction", async () => {
    const f = fixture(),
      controls = createAgentGuardianControlsV1();
    mocks.getDb.mockClear();
    expect(await controls.disable({ siteId: "default", reason: "Contain" })).toMatchObject({
      outcome: "blocked",
      errorCode: "GUARDIAN_AUTHORITY_REQUIRED",
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(f.state.value).toBeUndefined();
  });
  it("disables independently of missing registrations and stores no raw reason", async () => {
    const f = fixture(),
      controls = createAgentGuardianControlsV1({
        deploymentActorFingerprint: actor,
        now: f.options.now,
      });
    const result = await controls.disable({
      siteId: "default",
      reason: "private-operator-reason-marker",
    });
    expect(result).toMatchObject({
      outcome: "disabled",
      status: { capture: "disabled", registration: { state: "unavailable", sourceCount: null } },
    });
    expect(JSON.stringify(f.state)).not.toContain("private-operator-reason-marker");
    expect(await controls.readCaptureAdmission(f.input)).toMatchObject({
      state: "disabled",
      revision: 1,
    });
    expect((await controls.prepareEnable({ siteId: "default" })).errorCode).toBe(
      "GUARDIAN_READINESS_BLOCKED",
    );
  });
  it("is idempotent when disabled and invalidates an outstanding enable plan on another disable", async () => {
    const f = fixture();
    await f.controls.disable({ siteId: "default", reason: "Contain" });
    await f.controls.disable({ siteId: "default", reason: "Contain again" });
    expect(npRequireAgentGuardianControlV1(f.state.value).revision).toBe(1);
    expect(f.state.audit).toHaveLength(1);
    const plan = await f.plan();
    await f.controls.disable({ siteId: "default", reason: "Keep disabled" });
    expect(npRequireAgentGuardianControlV1(f.state.value)).toMatchObject({
      enabled: false,
      revision: 3,
      currentEnablePlan: null,
    });
    expect(
      (await f.controls.enable({ siteId: "default", plan, approval: plan.id })).errorCode,
    ).toBe("GUARDIAN_PLAN_INVALID");
  });
  it("requires a persisted exact actor-approved plan and permits exact successful replay", async () => {
    const f = fixture(),
      plan = await f.plan();
    expect(plan.expiresAt).toBe("2026-10-18T00:05:00.000Z");
    expect(
      (await f.controls.enable({ siteId: "default", plan, approval: "wrong" })).errorCode,
    ).toBe("GUARDIAN_PLAN_INVALID");
    expect(await f.controls.enable({ siteId: "default", plan, approval: plan.id })).toMatchObject({
      outcome: "enabled",
      status: {
        configured: true,
        revision: 3,
        capture: "enabled",
        response: "separate-policy-required",
      },
    });
    const count = f.state.audit.length;
    f.state.clock = new Date("2026-10-19T00:00:00.000Z");
    expect((await f.controls.enable({ siteId: "default", plan, approval: plan.id })).outcome).toBe(
      "enabled",
    );
    expect(f.state.audit).toHaveLength(count);
    expect(
      await f.controls.requireNewResponseAdmission({ ...f.input, expectedControlRevision: 3 }),
    ).toMatchObject({ state: "enabled", revision: 3 });
    await expect(
      f.controls.requireNewResponseAdmission({ ...f.input, expectedControlRevision: 0 }),
    ).rejects.toMatchObject({ code: "GUARDIAN_REVISION_CONFLICT" });
  });
  it("rejects caller-recomputed artifacts and another local actor without altering DB authority", async () => {
    const f = fixture(),
      plan = await f.plan();
    const { planHash: _hash, ...body } = plan;
    const changed = { ...body, id: "00000000-0000-4000-8000-000000000001" };
    const forged = { ...changed, planHash: hash("np.agent-guardian-enable-plan.v1", changed) };
    expect(
      (await f.controls.enable({ siteId: "default", plan: forged, approval: forged.id })).errorCode,
    ).toBe("GUARDIAN_PLAN_INVALID");
    const other = createAgentGuardianControlsV1({
      ...f.options,
      deploymentActorFingerprint: otherActor,
    });
    expect((await other.enable({ siteId: "default", plan, approval: plan.id })).errorCode).toBe(
      "GUARDIAN_PLAN_INVALID",
    );
    expect(npRequireAgentGuardianControlV1(f.state.value).enabled).toBe(false);
  });
  it("expires plans exactly at five minutes and rechecks current capture registrations", async () => {
    const f = fixture(),
      plan = await f.plan();
    f.state.registration.fingerprint = hash("registration", 2);
    expect(
      (await f.controls.enable({ siteId: "default", plan, approval: plan.id })).errorCode,
    ).toBe("GUARDIAN_READINESS_BLOCKED");
    f.state.registration.fingerprint = registrationHash;
    f.state.clock = new Date(plan.expiresAt);
    expect(
      (await f.controls.enable({ siteId: "default", plan, approval: plan.id })).errorCode,
    ).toBe("GUARDIAN_PLAN_EXPIRED");
    expect(npRequireAgentGuardianControlV1(f.state.value).enabled).toBe(false);
  });
  it("rechecks expiry after a slow registration probe and binds changed source counts", async () => {
    const f = fixture(),
      plan = await f.plan();
    f.state.registration.sourceCount = 2;
    expect(
      (await f.controls.enable({ siteId: "default", plan, approval: plan.id })).errorCode,
    ).toBe("GUARDIAN_READINESS_BLOCKED");
    f.state.registration.sourceCount = 1;
    f.registration.mockImplementationOnce(() => {
      f.state.clock = new Date(plan.expiresAt);
      return Promise.resolve({ ...f.state.registration });
    });
    expect(
      (await f.controls.enable({ siteId: "default", plan, approval: plan.id })).errorCode,
    ).toBe("GUARDIAN_PLAN_EXPIRED");
    expect(npRequireAgentGuardianControlV1(f.state.value).enabled).toBe(false);
  });
  it("distinguishes malformed persisted control from intentional disable", async () => {
    const f = fixture();
    f.state.value = { enabled: false };
    await expect(f.controls.readCaptureAdmission(f.input)).rejects.toMatchObject({
      code: "GUARDIAN_STATE_INVALID",
    });
    expect((await f.controls.disable({ siteId: "default", reason: "Contain" })).errorCode).toBe(
      "GUARDIAN_STATE_INVALID",
    );
    expect(f.state.value).toEqual({ enabled: false });
  });
  it("does not turn absent registration evidence into healthy zero or an enable plan", async () => {
    const f = fixture(),
      unregistered = createAgentGuardianControlsV1({
        deploymentActorFingerprint: actor,
        now: f.options.now,
      });
    expect((await unregistered.status({ siteId: "default" })).status).toMatchObject({
      capture: "unavailable",
      registration: { sourceCount: null, state: "unavailable" },
    });
    f.state.registration = { sourceCount: 0, ready: true, fingerprint: registrationHash };
    await f.controls.disable({ siteId: "default", reason: "Contain" });
    expect((await f.controls.prepareEnable({ siteId: "default" })).errorCode).toBe(
      "GUARDIAN_SOURCE_ABSENT",
    );
  });
  it("rolls back a local disable if its audit receipt cannot commit", async () => {
    const f = fixture();
    f.state.failAudit = true;
    const result = await f.controls.disable({ siteId: "default", reason: "Contain" });
    expect(result).toMatchObject({ outcome: "blocked", errorCode: "GUARDIAN_UNAVAILABLE" });
    expect(f.state.value).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private-audit");
  });
  it("rejects deleted sites, extra fields and malformed plan lifetimes", async () => {
    const f = fixture();
    f.state.deleting = true;
    expect((await f.controls.disable({ siteId: "default", reason: "Contain" })).errorCode).toBe(
      "GUARDIAN_SITE_UNAVAILABLE",
    );
    f.state.deleting = false;
    const plan = await f.plan();
    expect(() =>
      npRequireAgentGuardianEnablePlanV1({ ...plan, expiresAt: plan.issuedAt }),
    ).toThrow();
    expect(() => npRequireAgentGuardianEnablePlanV1({ ...plan, rawKey: "secret" })).toThrow();
  });
});

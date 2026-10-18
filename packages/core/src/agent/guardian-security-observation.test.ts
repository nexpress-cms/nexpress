import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { getDb } from "../db/runtime.js";
import type { NpSiteAuthorityObservationV1 } from "../sites/authority-observer.js";
import { createAgentGuardianSecurityObservationServiceV1 } from "./guardian-security-observation.js";

const mocks = vi.hoisted(() => ({ lock: vi.fn() }));
vi.mock("./guardian-capture-admission.js", () => ({
  npReadAgentGuardianCaptureAdmissionV1: () =>
    Promise.resolve({ state: "enabled-by-registration" }),
}));
vi.mock("./runtime-controls.js", () => ({ npWithAgentRuntimeControlTransactionV1: mocks.lock }));
type Db = ReturnType<typeof getDb>;
const id = "00000000-0000-4000-8000-000000000001";
function fixture(catalog = ["default"]) {
  const state = { transactionId: "10", catalog, statement: "0", lock: "0" };
  const milliseconds = (value: string) => Number(value.replace(/ms$/u, ""));
  const execute = vi.fn(async (query: SQL) => {
    await Promise.resolve();
    const parsed = new PgDialect().sqlToQuery(query);
    if (parsed.sql.includes("current_setting"))
      return {
        rows: [
          {
            statement_original: state.statement,
            statement_milliseconds: milliseconds(state.statement),
            lock_original: state.lock,
            lock_milliseconds: milliseconds(state.lock),
          },
        ],
      };
    if (parsed.sql.includes("set_config")) {
      state.statement = String(parsed.params[0]);
      state.lock = String(parsed.params[1]);
    }
    return { rows: [{ id: state.transactionId }] };
  });
  const db = {
    execute,
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(state.catalog.map((siteId) => ({ id: siteId }))),
          }),
        }),
      }),
    }),
  } as unknown as Db;
  mocks.lock.mockImplementation(
    async (siteId: string, operation: (context: { db: Db }) => Promise<void>, tx: Db) =>
      operation({ db: tx }),
  );
  const record =
    vi.fn<
      Parameters<typeof createAgentGuardianSecurityObservationServiceV1>[0]["events"]["record"]
    >();
  const authorize = vi.fn(() => Promise.resolve());
  const service = createAgentGuardianSecurityObservationServiceV1({
    actorKey: { id: "unit-key", bytes: new Uint8Array(32).fill(9) },
    isInstalledSite: (siteId) => Promise.resolve(siteId !== "uninstalled"),
    authorize,
    events: { record },
  });
  const input: NpSiteAuthorityObservationV1 = {
    db,
    scope: { kind: "site", siteId: "default" },
    actor: { kind: "system", component: "sites.memberships" },
    transitionId: id,
    occurredAt: new Date(),
    transition: { kind: "site-role", userId: id, previousRole: "viewer", currentRole: "admin" },
  };
  return { service, state, db, execute, authorize, record, input };
}
describe("Guardian committed security transition source", () => {
  it("projects raw state only inside a prepared transaction and returns no config or locator material", async () => {
    const f = fixture(),
      readState = vi.fn(() =>
        Promise.resolve({
          privateConfig: "source-secret-marker",
          secretRef: "private-locator-marker",
        }),
      );
    await expect(
      f.service.sensitiveObserver.projectState({
        db: f.db,
        scope: f.input.scope,
        kind: "plugin-config",
        targetId: "search",
        readState,
      }),
    ).rejects.toThrow();
    expect(readState).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    await f.service.sensitiveObserver.prepare({ db: f.db, scope: f.input.scope });
    const first = await f.service.sensitiveObserver.projectState({
      db: f.db,
      scope: f.input.scope,
      kind: "plugin-config",
      targetId: "search",
      readState,
    });
    const replay = await f.service.sensitiveObserver.projectState({
      db: f.db,
      scope: f.input.scope,
      kind: "plugin-config",
      targetId: "search",
      readState,
    });
    const other = await f.service.sensitiveObserver.projectState({
      db: f.db,
      scope: f.input.scope,
      kind: "plugin-config",
      targetId: "other",
      readState,
    });
    expect(first).toEqual(replay);
    expect(first).not.toEqual(other);
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(
      /source-secret-marker|private-locator-marker|privateConfig|secretRef/u,
    );
    expect(f.record).not.toHaveBeenCalled();
  });
  it("rejects forged, cloned and stale state commitments even when their wire shape is valid", async () => {
    const f = fixture();
    await f.service.sensitiveObserver.prepare({ db: f.db, scope: f.input.scope });
    const previous = await f.service.sensitiveObserver.projectState({
      db: f.db,
      scope: f.input.scope,
      kind: "plugin-activation",
      targetId: "search",
      readState: () => Promise.resolve({ enabled: true }),
    });
    const current = await f.service.sensitiveObserver.projectState({
      db: f.db,
      scope: f.input.scope,
      kind: "plugin-activation",
      targetId: "search",
      readState: () => Promise.resolve({ enabled: false }),
    });
    const input = {
      db: f.db,
      scope: f.input.scope,
      actor: f.input.actor,
      transitionId: id,
      occurredAt: new Date(),
      transition: {
        kind: "plugin-activation",
        pluginId: "search",
        previous: { enabled: true, commitment: previous },
        current: { enabled: false, commitment: current },
      },
    } as const;
    await expect(
      f.service.sensitiveObserver.recordPlugin({
        ...input,
        transition: {
          ...input.transition,
          current: { ...input.transition.current, commitment: { ...current } },
        },
      }),
    ).rejects.toThrow();
    const wrongTarget = { ...input, transition: { ...input.transition, pluginId: "other" } };
    await expect(f.service.sensitiveObserver.recordPlugin(wrongTarget)).rejects.toThrow();
    f.state.transactionId = "11";
    await expect(f.service.sensitiveObserver.recordPlugin(input)).rejects.toThrow();
    expect(f.record).not.toHaveBeenCalled();
  });
  it("reuses deployment-ordered site preparation for private principal scope commitments without taking new locks", async () => {
    const f = fixture(["default", "other"]),
      scope = { kind: "site" as const, siteId: "other" };
    mocks.lock.mockClear();
    await f.service.sensitiveObserver.prepare({ db: f.db, scope: { kind: "deployment" } });
    expect(mocks.lock.mock.calls.map(([site]) => site)).toEqual(["default", "other"]);
    const before = await f.service.sensitiveObserver.projectState({
      db: f.db,
      scope,
      kind: "gateway-principal",
      targetId: id,
      readState: () => Promise.resolve(["site:read"]),
    });
    const after = await f.service.sensitiveObserver.projectState({
      db: f.db,
      scope,
      kind: "gateway-principal",
      targetId: id,
      readState: () => Promise.resolve(["content:read", "site:read"]),
    });
    expect(after).not.toEqual(before);
    expect(JSON.stringify([before, after])).not.toMatch(/content:read|site:read/u);
    await expect(
      f.service.sensitiveObserver.recordCredential({
        db: f.db,
        scope,
        actor: f.input.actor,
        transitionId: id,
        occurredAt: new Date(),
        transition: {
          kind: "gateway-principal",
          principalId: id,
          reason: "updated",
          previous: {
            rowVersion: 1,
            tokenVersion: 1,
            status: "active",
            authorityPresent: true,
            scopeCommitment: before,
          },
          current: {
            rowVersion: 2,
            tokenVersion: 2,
            status: "active",
            authorityPresent: true,
            scopeCommitment: { ...after },
          },
        },
      }),
    ).rejects.toThrow();
    expect(mocks.lock).toHaveBeenCalledTimes(2);
    expect(f.record).not.toHaveBeenCalled();
  });
  it("uses source caps then restores the exact owning transaction settings", async () => {
    const f = fixture();
    f.state.statement = "2000ms";
    f.state.lock = "1500ms";
    f.authorize.mockImplementation(async () => {
      await Promise.resolve();
      expect(f.state.statement).toBe("500ms");
      expect(f.state.lock).toBe("100ms");
    });
    await f.service.authorityObserver.prepare({ db: f.db, scope: f.input.scope });
    expect(f.state).toMatchObject({ statement: "2000ms", lock: "1500ms" });
  });
  it("preserves stricter budgets and restores them when source preparation or recording fails", async () => {
    const f = fixture();
    f.state.statement = "10ms";
    f.state.lock = "1ms";
    f.authorize.mockImplementation(async () => {
      await Promise.resolve();
      expect(f.state.statement).toBe("10ms");
      expect(f.state.lock).toBe("1ms");
    });
    await f.service.authorityObserver.prepare({ db: f.db, scope: f.input.scope });
    f.state.transactionId = "11";
    await expect(f.service.authorityObserver.record(f.input)).rejects.toThrow();
    expect(f.state).toMatchObject({ statement: "10ms", lock: "1ms" });
    f.authorize.mockRejectedValue(new Error("Injected authorization failure"));
    await expect(
      f.service.authorityObserver.prepare({ db: f.db, scope: f.input.scope }),
    ).rejects.toThrow("Injected authorization failure");
    expect(f.state).toMatchObject({ statement: "10ms", lock: "1ms" });
  });
  it("requires explicit valid copied key installation", () => {
    const f = fixture();
    expect(() =>
      createAgentGuardianSecurityObservationServiceV1({
        actorKey: { id: "bad-key", bytes: new Uint8Array(31) },
        isInstalledSite: () => Promise.resolve(true),
        authorize: f.authorize,
        events: { record: f.record },
      }),
    ).toThrow();
    expect(f.record).not.toHaveBeenCalled();
  });
  it("rejects unprepared recording before touching a database or event owner", async () => {
    const f = fixture();
    await expect(f.service.authorityObserver.record(f.input)).rejects.toMatchObject({
      code: "GUARDIAN_SECURITY_EVIDENCE_UNAVAILABLE",
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });
  it("binds preparation to the exact transaction as well as DB object", async () => {
    const f = fixture();
    await f.service.authorityObserver.prepare({ db: f.db, scope: f.input.scope });
    f.state.transactionId = "11";
    await expect(f.service.authorityObserver.record(f.input)).rejects.toMatchObject({
      code: "GUARDIAN_SECURITY_EVIDENCE_UNAVAILABLE",
    });
    expect(f.record).not.toHaveBeenCalled();
  });
  it("locks only installed sites in catalog order before returning deployment preparation", async () => {
    const f = fixture(["alpha", "default", "uninstalled"]);
    mocks.lock.mockClear();
    await f.service.authorityObserver.prepare({ db: f.db, scope: { kind: "deployment" } });
    expect(mocks.lock.mock.calls.map((call) => call[0])).toEqual(["alpha", "default"]);
    expect(f.authorize).toHaveBeenCalledTimes(2);
    expect(f.record).not.toHaveBeenCalled();
  });
  it("refuses a truncated deployment catalog before acquiring site locks", async () => {
    const f = fixture(Array.from({ length: 10_001 }, (_, n) => `site-${n.toString()}`));
    mocks.lock.mockClear();
    await expect(
      f.service.authorityObserver.prepare({ db: f.db, scope: { kind: "deployment" } }),
    ).rejects.toMatchObject({ code: "GUARDIAN_SECURITY_EVIDENCE_UNAVAILABLE" });
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("emits no source facts for a validated authority no-op", async () => {
    const f = fixture();
    await f.service.authorityObserver.record({
      ...f.input,
      transition: { kind: "site-role", userId: id, previousRole: "admin", currentRole: "admin" },
    });
    await f.service.authorityObserver.record({
      ...f.input,
      scope: { kind: "deployment" },
      transition: { kind: "super-admin", userId: id, previous: true, current: true },
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });

  it("validates a policy no-op through the exact parser before skipping source recording", async () => {
    const f = fixture();
    const current = {
      version: 1,
      rowVersion: 1,
      contentHash: `cj1:sha256:${"A".repeat(43)}`,
      status: "active" as const,
    };
    await f.service.recordPolicy({
      db: f.db,
      siteId: "default",
      actorUserId: id,
      invocationId: id,
      transitionId: id,
      occurredAt: new Date(),
      transition: {
        kind: "agent-policy",
        policyId: id,
        agentId: null,
        previous: { ...current },
        current: { ...current },
      },
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
    const invalid = { ...current, status: "unknown" };
    await expect(
      Reflect.apply(
        (input: Parameters<typeof f.service.recordPolicy>[0]) => f.service.recordPolicy(input),
        undefined,
        [
          {
            db: f.db,
            siteId: "default",
            actorUserId: id,
            invocationId: id,
            transitionId: id,
            occurredAt: new Date(),
            transition: {
              kind: "agent-policy",
              policyId: id,
              agentId: null,
              previous: { ...invalid },
              current: { ...invalid },
            },
          },
        ],
      ),
    ).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
  });
});
